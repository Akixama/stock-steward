import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {queueAlertPush,saveDevice,sendPendingPush,validPushSubscription} from './web-push.ts';
import type {PriceAlert} from './price-alerts.ts';

function p256(){const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const publicJwk=pair.publicKey.export({format:'jwk'}),privateJwk=pair.privateKey.export({format:'jwk'});return {publicKey:Buffer.concat([Buffer.from([4]),Buffer.from(publicJwk.x!,'base64url'),Buffer.from(publicJwk.y!,'base64url')]).toString('base64url'),privateKey:privateJwk.d!};}
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec("CREATE TABLE price_alerts(id text PRIMARY KEY,owner_ref text,symbol text,direction text,price_cents integer,created_at text,status text,triggered_at text,observed_price_cents integer);");
 const migration=readFileSync(new URL('../drizzle/0015_flaky_bloodstorm.sql',import.meta.url),'utf8');
 for(const statement of migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))sql.exec(statement);
 const db={prepare(query:string){let args:unknown[]=[];const statement={bind(...values:unknown[]){args=values;return statement;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args as never[]).changes)}};},async first(){return sql.prepare(query).get(...args as never[])??null;},async all(){return {results:sql.prepare(query).all(...args as never[])}}};return statement;},async batch(statements:{run():Promise<unknown>}[]){sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}} as unknown as D1Database;
 return {db,sql};
}

test('only browser push services can be registered',()=>{
 const keys=p256(),subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',expirationTime:null,keys:{p256dh:keys.publicKey,auth:randomBytes(16).toString('base64url')}};
 assert.equal(validPushSubscription(subscription),true);
 assert.equal(validPushSubscription({...subscription,endpoint:'https://127.0.0.1/private'}),false);
 assert.equal(validPushSubscription({...subscription,endpoint:'https://fcm.googleapis.com.evil.test/fcm/send/test'}),false);
 assert.equal(validPushSubscription({...subscription,endpoint:'http://fcm.googleapis.com/fcm/send/test'}),false);
});

test('a triggered alert creates one owner-bound encrypted push and is never resent',async()=>{
 const {db,sql}=fixture();
 try{
  const vapid=p256(),subscriber=p256();
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test',expirationTime:null,keys:{p256dh:subscriber.publicKey,auth:randomBytes(16).toString('base64url')}};
  await saveDevice(db,'alice',subscription);
  await saveDevice(db,'bob',subscription);
  assert.equal((sql.prepare('SELECT owner_ref FROM push_subscriptions').get() as {owner_ref:string}).owner_ref,'bob');
  await saveDevice(db,'alice',subscription);
  const alert:PriceAlert={id:'alert-1',symbol:'AAPL',direction:'above',priceCents:20000,createdAt:new Date().toISOString(),status:'triggered',triggeredAt:new Date().toISOString(),observedPriceCents:20100};
  sql.prepare('INSERT INTO price_alerts VALUES(?,?,?,?,?,?,?,?,?)').run(alert.id,'alice',alert.symbol,alert.direction,alert.priceCents,alert.createdAt,alert.status,alert.triggeredAt,alert.observedPriceCents);
  await queueAlertPush(db,'alice',[alert]);await queueAlertPush(db,'alice',[alert]);
  assert.equal((sql.prepare('SELECT COUNT(*) AS n FROM push_deliveries').get() as {n:number}).n,1);
  let requests=0;
  const fetcher=(async(_url:RequestInfo|URL,options?:RequestInit)=>{requests++;assert.ok(options?.body);return new Response(null,{status:201});}) as typeof fetch;
  assert.deepEqual(await sendPendingPush(db,vapid,10,fetcher),{sent:1,failed:0});
  assert.deepEqual(await sendPendingPush(db,vapid,10,fetcher),{sent:0,failed:0});
  assert.equal(requests,1);
 }finally{sql.close();}
});
