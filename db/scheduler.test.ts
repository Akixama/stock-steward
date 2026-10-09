import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {setSchedule,getSchedule,claimSchedule,finishSchedule,controlSchedule,claimWorker,finishWorker,scheduleRuns} from './scheduler.ts';
import {autonomyReadiness} from '../lib/autonomy.ts';import type {PricedObservation} from '../lib/chain-analysis.ts';
function database(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../drizzle/0008_violet_blade.sql',import.meta.url),'utf8'));
  sql.exec('CREATE TABLE chain_observations(id TEXT PRIMARY KEY,owner_ref TEXT,address TEXT,record_json TEXT,created_at TEXT); CREATE TABLE autonomy_runs(id TEXT PRIMARY KEY,owner_ref TEXT,address TEXT,receipt_json TEXT,created_at TEXT);');
  const db={prepare(query:string){return {bind(...args:(string|number|null)[]){return {async run(){return {meta:{changes:Number(sql.prepare(query).run(...args).changes)}};},async first(){return sql.prepare(query).get(...args)??null;},async all(){return {results:sql.prepare(query).all(...args)};}};}};},async batch(statements:{run():Promise<unknown>}[]){sql.exec('BEGIN');try{const output=[];for(const s of statements)output.push(await s.run());sql.exec('COMMIT');return output;}catch(e){sql.exec('ROLLBACK');throw e;}}} as unknown as D1Database;return {sql,db};}
const address='0x'+'a'.repeat(40),now=new Date('2026-09-26T12:00:00Z');
const observation=()=>({id:crypto.randomUUID(),address,observedAt:now.toISOString(),failures:0}) as PricedObservation;
test('worker claims once, preserves stable retry IDs, fences interrupted attempts and persists a single result',async()=>{
  const {sql,db}=database();assert.equal(await setSchedule(db,'owner',address,15,0,now),true);
  const schedule=(await getSchedule(db,'owner'))!;const one=(await claimSchedule(db,schedule,now))!;
  assert.equal(await claimSchedule(db,schedule,now),null);
  const later=new Date(now.getTime()+11*60000);const two=(await claimSchedule(db,schedule,later))!;
  assert.equal(one.runId,two.runId);assert.notEqual(one.token,two.token);
  await finishSchedule(db,one,observation(),autonomyReadiness(address,null,null,now),later);
  assert.equal((await scheduleRuns(db,'owner'))[0].status,'running');assert.equal(sql.prepare('SELECT COUNT(*) n FROM chain_observations').get()?.n,0);
  await finishSchedule(db,two,observation(),autonomyReadiness(address,null,null,now),later);
  assert.equal((await scheduleRuns(db,'owner'))[0].status,'observed');assert.equal(sql.prepare('SELECT COUNT(*) n FROM chain_observations').get()?.n,1);
  await finishSchedule(db,two,observation(),autonomyReadiness(address,null,null,now),later);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM chain_observations').get()?.n,1);assert.equal((await scheduleRuns(db,'owner'))[0].attempts,2);
  sql.close();
});
test('pause and stale revisions prevent background writes; circuit breaker pauses three failures',async()=>{
  const {sql,db}=database();await setSchedule(db,'a',address,15,0,now);const s=(await getSchedule(db,'a'))!,claim=(await claimSchedule(db,s,now))!;
  assert.equal(await controlSchedule(db,'b',1,false,now),false);
  assert.equal(await controlSchedule(db,'a',1,false,now),true);assert.equal(await setSchedule(db,'a',address,30,1,now),false);
  await finishSchedule(db,claim,observation(),autonomyReadiness(address,null,null,now),now);
  assert.equal((await scheduleRuns(db,'a'))[0].status,'canceled');assert.equal(sql.prepare('SELECT COUNT(*) n FROM chain_observations').get()?.n,0);
  assert.equal(await controlSchedule(db,'a',2,true,now),true);
  for(let i=0;i<3;i++){const tick=new Date(now.getTime()+i*16*60000);const current=(await getSchedule(db,'a'))!;const c=(await claimSchedule(db,current,tick))!;assert.ok(c);await finishSchedule(db,c,null,null,tick);}
  assert.equal((await getSchedule(db,'a'))?.enabled,0);assert.equal((await getSchedule(db,'a'))?.failure_count,3);
  assert.deepEqual(await scheduleRuns(db,'b'),[]);sql.close();
});
test('global worker lease rejects overlap and expired worker cannot clear a new lease',async()=>{
  const {sql,db}=database();const one=(await claimWorker(db,now))!;assert.equal(await claimWorker(db,now),null);
  const two=(await claimWorker(db,new Date(now.getTime()+11*60000)))!;await finishWorker(db,one,{old:true});
  assert.equal(sql.prepare("SELECT lease_token FROM autonomy_worker_health WHERE id='monitor'").get()?.lease_token,two);
  await finishWorker(db,two,{done:true});assert.equal(sql.prepare("SELECT lease_token FROM autonomy_worker_health WHERE id='monitor'").get()?.lease_token,null);sql.close();
});
