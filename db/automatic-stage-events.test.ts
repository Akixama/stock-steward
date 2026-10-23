import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {saveAutomaticEvent,automaticEvents,claimProposalReview,type AutomaticStageEvent} from './automatic-stage-events.ts';
import {queueAutomaticPush} from '../lib/automatic-stage-push.ts';

function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE autonomous_shadow_plans(enabled INTEGER,lease_token TEXT,lease_until TEXT)');
 sql.exec("INSERT INTO autonomous_shadow_plans VALUES(1,'old-lease','2026-10-22T00:00:00Z')");
 sql.exec(readFileSync(new URL('../drizzle/0036_automatic_stage_events.sql',import.meta.url),'utf8'));
 sql.exec('CREATE TABLE push_subscriptions(id TEXT PRIMARY KEY,owner_ref TEXT,endpoint TEXT,p256dh TEXT,auth TEXT)');
 const db={prepare(query:string){let args:unknown[]=[];const stmt={bind(...values:unknown[]){args=values;return stmt;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args as never[]).changes)}};},async first<T>(){return sql.prepare(query).get(...args as never[]) as T|null??null;},async all<T>(){return {results:sql.prepare(query).all(...args as never[]) as T[]};}};return stmt;}} as unknown as D1Database;
 return {sql,db};
}
const runId='0x'+'a'.repeat(64);
function event(kind:AutomaticStageEvent['kind']):AutomaticStageEvent{return {id:`${runId}:${kind}`,owner_ref:'alice',run_id:runId,kind,status:kind==='proposal'?'proposed':'checking',symbol:'AAPL',amount_cents:100,detail:'Review required.',transaction_hash:null,created_at:'2026-10-21T00:00:00.000Z',expires_at:'2026-10-21T00:15:00.000Z'};}

test('proposal is saved once and queued to the owner device only',async()=>{
 const {sql,db}=database();try{
  assert.deepEqual({...sql.prepare('SELECT enabled,lease_token,lease_until FROM autonomous_shadow_plans').get()},{enabled:0,lease_token:null,lease_until:null});
  sql.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?,?)').run('one','alice','https://example.test/push','p','a');
  sql.prepare('INSERT INTO push_subscriptions VALUES(?,?,?,?,?)').run('two','bob','https://example.test/other','p','a');
  const proposal=event('proposal');
  assert.equal(await saveAutomaticEvent(db,proposal),true);
  assert.equal(await saveAutomaticEvent(db,proposal),false);
  await queueAutomaticPush(db,proposal);await queueAutomaticPush(db,proposal);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM automatic_stage_events').get()!.n,1);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM automatic_stage_deliveries').get()!.n,1);
  assert.equal((await automaticEvents(db,'alice')).length,1);
  assert.equal((await automaticEvents(db,'bob')).length,0);
 }finally{sql.close();}
});
test('one-use proposal cannot open for another owner, after expiry, or twice',async()=>{
 const {sql,db}=database();try{
  const proposal=event('proposal');await saveAutomaticEvent(db,proposal);
  assert.equal(await claimProposalReview(db,'bob',proposal.id,new Date('2026-10-21T00:01:00Z')),null);
  assert.equal(await claimProposalReview(db,'alice',proposal.id,new Date('2026-10-21T00:16:00Z')),null);
  assert.deepEqual({...await claimProposalReview(db,'alice',proposal.id,new Date('2026-10-21T00:01:00Z'))},{symbol:'AAPL',amount_cents:100,expires_at:proposal.expires_at});
  assert.equal(await claimProposalReview(db,'alice',proposal.id,new Date('2026-10-21T00:02:00Z')),null);
  assert.equal(sql.prepare('SELECT status FROM automatic_stage_events').get()!.status,'checking');
 }finally{sql.close();}
});

test('pre-action alert persists once before an outcome and cannot be reused as a proposal',async()=>{
 const {sql,db}=database();try{
  const started=event('auto_started');
  assert.equal(await saveAutomaticEvent(db,started),true);
  assert.equal(await saveAutomaticEvent(db,started),false);
  assert.equal(await saveAutomaticEvent(db,{...event('auto_action'),status:'unknown'}),true);
  assert.equal((await automaticEvents(db,'alice')).length,2);
  await assert.rejects(saveAutomaticEvent(db,{...started,id:`${runId}:proposal`}));
 }finally{sql.close();}
});
