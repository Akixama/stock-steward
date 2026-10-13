import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {deliverOperatorAlert,dispatchOperatorAlerts} from './operator-alerts.ts';

const config={enabled:true,url:'https://alerts.example.com/steward',secret:'ab'.repeat(32)};
const alert={id:'incident',kind:'receipt_delayed',severity:'warning',message:'Receipt delayed.',created_at:'2026-10-12T12:00:00Z'};
test('disabled or unsafe alert destinations never call network; valid payloads are signed and redacted',async()=>{
 for(const candidate of [{...config,enabled:false},{...config,url:'http://alerts.example.com'},{...config,url:'https://127.0.0.1'},{...config,url:'https://a.internal'},{...config,url:'https://u:p@alerts.example.com'},{...config,secret:'bad'}])assert.equal(await deliverOperatorAlert(alert,candidate,async()=>{assert.fail('must not send');}),false);
 assert.equal(await deliverOperatorAlert({...alert,owner_ref:'private',raw_transaction:'private'} as typeof alert,config,async(url,init)=>{
  assert.equal(url,config.url);assert.equal(init?.redirect,'error');
  const body=String(init?.body),headers=new Headers(init?.headers);
  assert.equal(body.includes('private'),false);assert.equal(headers.get('Idempotency-Key'),alert.id);
  const key=await crypto.subtle.importKey('raw',new Uint8Array(32).fill(171),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(headers.get('X-Steward-Timestamp')+'.'+body)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  assert.equal(headers.get('X-Steward-Signature'),signature);return new Response(null,{status:204});
 },new Date(alert.created_at)),true);
});

test('alert delivery retries are durable and bounded; concurrent delivery and financial state are untouched',async()=>{
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0024_autonomous_incidents.sql','0030_operator_alert_delivery.sql'])sql.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 sql.prepare('INSERT INTO autonomous_incidents(id,owner_ref,kind,subject_id,severity,message,created_at) VALUES(?,?,?,?,?,?,?)').run(alert.id,'alice',alert.kind,'subject',alert.severity,alert.message,alert.created_at);
 const db={prepare(query:string){let args:unknown[]=[];const statement={bind(...a:unknown[]){args=a;return statement;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args as never[]).changes)}};},async all(){return {results:sql.prepare(query).all(...args as never[])};}};return statement;}} as unknown as D1Database;
 let calls=0;
 const fail:typeof fetch=async()=>{calls++;return new Response(null,{status:503});};
 try{
  assert.equal((await dispatchOperatorAlerts(db,{...config,enabled:false},fail,new Date(alert.created_at))).configured,false);
  for(let i=0;i<5;i++){
   const time=new Date(Date.parse(alert.created_at)+i*3600000);
   assert.equal((await dispatchOperatorAlerts(db,config,fail,time)).failed,1);
   assert.equal((await dispatchOperatorAlerts(db,config,fail,time)).failed,0);
  }
  assert.equal((await dispatchOperatorAlerts(db,config,fail,new Date('2026-10-13T12:00:00Z'))).failed,0);
  assert.equal(calls,5);assert.ok(sql.prepare('SELECT exhausted_at FROM autonomous_alert_deliveries').get()!.exhausted_at);
  sql.prepare('DELETE FROM autonomous_alert_deliveries').run();
  let nestedCalls=0;
  const sent:typeof fetch=async()=>{nestedCalls++;assert.equal((await dispatchOperatorAlerts(db,config,fail,new Date(alert.created_at))).failed,0);return new Response(null,{status:204});};
  assert.equal((await dispatchOperatorAlerts(db,config,sent,new Date(alert.created_at))).delivered,1);
  assert.equal(nestedCalls,1);assert.equal((await dispatchOperatorAlerts(db,config,sent,new Date(alert.created_at))).delivered,0);
 }finally{sql.close();}
});
