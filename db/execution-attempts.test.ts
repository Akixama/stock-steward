import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {reserveAttempt,getAttempt,beginAttempt,recordSubmission,recordUnknown,cancelReservation,settleAttempt,recoverInterruptedAttempt,listSpendEvidence,type AttemptPlan} from './execution-attempts.ts';
import {routerCandidate} from '../lib/router-candidate.ts';
import {VENUE,poolIdentity,type RouteEvidence} from '../lib/chain-route.ts';
import type {RouterCandidate} from '../lib/router-candidate.ts';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE autonomy_spends(owner_ref TEXT,address TEXT,execution_day TEXT,intent_id TEXT,amount_cents INTEGER,state TEXT,PRIMARY KEY(owner_ref,address,intent_id));');
 sql.exec(readFileSync(new URL('../drizzle/0010_flimsy_paibok.sql',import.meta.url),'utf8'));
 const db={prepare(query:string){let values:(string|number|null)[]=[];const statement={bind(...args:(string|number|null)[]){values=args;return statement;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};},async first(){return sql.prepare(query).get(...values)??null;},async all(){return {results:sql.prepare(query).all(...values)}}};return statement;},async batch(statements:{run:()=>Promise<unknown>}[]){sql.exec('BEGIN');try{const output=[];for(const s of statements)output.push(await s.run());sql.exec('COMMIT');return output;}catch(error){sql.exec('ROLLBACK');throw error;}}} as unknown as D1Database;
 return {db,sql};
}
const now=new Date('2026-09-27T12:00:00Z'),address='0x'+'a'.repeat(40),hash='0x'+'b'.repeat(64);
function plan(n:number,owner='alice',amount=60):AttemptPlan{const digest='0x'+n.toString(16).padStart(64,'0');return {owner,address,intentDigest:digest,mandateVersion:1,day:'2026-09-27',amountCents:amount,dailyCapCents:100,candidate:{from:address,intentDigest:digest} as RouterCandidate};}
test('real SQLite migration and atomic reservations reject duplicates and isolate owners',async()=>{const {db,sql}=fixture();try{const p=plan(1);assert.equal(await reserveAttempt(db,p,now),true);assert.equal(await reserveAttempt(db,p,now),false);assert.equal(await reserveAttempt(db,plan(2),now),false);assert.equal(await reserveAttempt(db,plan(3,'bob'),now),true);assert.equal(await getAttempt(db,'bob',p.intentDigest),null);assert.equal(await reserveAttempt(db,plan(4,'alice',40),now),true);}finally{sql.close();}});
test('attempt claim is one-time, mandate-bound and uncertain outcomes retain budget across days',async()=>{const {db,sql}=fixture();try{const p=plan(1);await reserveAttempt(db,p,now);assert.equal(await beginAttempt(db,'alice',p.intentDigest,2,now),false);assert.equal(await beginAttempt(db,'alice',p.intentDigest,1,now),true);assert.equal(await beginAttempt(db,'alice',p.intentDigest,1,now),false);assert.equal(await recoverInterruptedAttempt(db,'alice',p.intentDigest,now),true);assert.equal(await cancelReservation(db,'alice',p.intentDigest,now),false);assert.equal(await beginAttempt(db,'alice',p.intentDigest,1,now),false);const tomorrow=new Date('2026-09-28T12:00:00Z');assert.equal(await reserveAttempt(db,{...plan(2),day:'2026-09-28'},tomorrow),false);assert.equal(await recordSubmission(db,'alice',p.intentDigest,hash,now),true);assert.equal(await recordUnknown(db,'alice',p.intentDigest,now),true);assert.equal(await recordSubmission(db,'alice',p.intentDigest,'0x'+'c'.repeat(64),now),false);assert.equal((await getAttempt(db,'alice',p.intentDigest))?.transaction_hash,hash);}finally{sql.close();}});
test('only unattempted reservations release without final evidence; outer success is not a verified fill',async()=>{const {db,sql}=fixture();try{const p=plan(1);await reserveAttempt(db,p,now);assert.equal(await cancelReservation(db,'bob',p.intentDigest,now),false);assert.equal(await cancelReservation(db,'alice',p.intentDigest,now),true);const q=plan(2);await reserveAttempt(db,q,now);await beginAttempt(db,'alice',q.intentDigest,1,now);await recordSubmission(db,'alice',q.intentDigest,hash,now);const proof={hash,canonicalFinalized:true,outcome:'unknown' as const,intentDigest:q.intentDigest};assert.equal(await settleAttempt(db,'alice',q.intentDigest,proof,now),false);assert.equal(await settleAttempt(db,'alice',q.intentDigest,{...proof,outcome:'reverted',canonicalFinalized:false},now),false);assert.equal(await settleAttempt(db,'alice',q.intentDigest,{...proof,outcome:'reverted',intentDigest:p.intentDigest},now),false);assert.equal(await settleAttempt(db,'alice',q.intentDigest,{...proof,outcome:'reverted'},now),true);assert.equal((await getAttempt(db,'alice',q.intentDigest))?.state,'reverted');assert.equal(sql.prepare('SELECT state FROM autonomy_spends WHERE intent_id=?').get(q.intentDigest)?.state,'released');}finally{sql.close();}});
test('a transaction hash cannot settle another intent and confirmed current-day spend still counts',async()=>{const {db,sql}=fixture();try{const p=plan(1);await reserveAttempt(db,p,now);await beginAttempt(db,'alice',p.intentDigest,1,now);await recordSubmission(db,'alice',p.intentDigest,hash,now);assert.equal(await settleAttempt(db,'alice',p.intentDigest,{hash,canonicalFinalized:true,outcome:'verified_fill',intentDigest:p.intentDigest},now),true);assert.equal(await reserveAttempt(db,plan(2,'alice',41),now),false);const q=plan(3,'bob');await reserveAttempt(db,q,now);await beginAttempt(db,'bob',q.intentDigest,1,now);assert.equal(await recordSubmission(db,'bob',q.intentDigest,hash.toUpperCase().replace('0X','0x'),now),false);assert.equal((await getAttempt(db,'bob',q.intentDigest))?.state,'attempting');assert.equal(await settleAttempt(db,'alice',p.intentDigest,{hash,canonicalFinalized:true,outcome:'reverted',intentDigest:p.intentDigest},now),false);}finally{sql.close();}});
test('spend evidence retains in-flight attempting reservations and separates filled from pending',async()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE execution_attempts(id TEXT PRIMARY KEY,owner_ref TEXT NOT NULL,address TEXT NOT NULL,intent_digest TEXT NOT NULL,mandate_version INTEGER NOT NULL,execution_day TEXT NOT NULL,amount_cents INTEGER NOT NULL,state TEXT NOT NULL,plan_json TEXT NOT NULL,transaction_hash TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);');
 const db={prepare(query:string){let values:(string|number|null)[]=[];const statement={bind(...args:(string|number|null)[]){values=args;return statement;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};},async first(){return sql.prepare(query).get(...values)??null;},async all(){return {results:sql.prepare(query).all(...values)}}};return statement;}} as unknown as D1Database;
 try{
  const today=new Date().toISOString().slice(0,10),digest='0x'+'d'.repeat(64),digest2='0x'+'e'.repeat(64),stamp=new Date().toISOString();
  const insert=sql.prepare('INSERT INTO execution_attempts(id,owner_ref,address,intent_digest,mandate_version,execution_day,amount_cents,state,plan_json,transaction_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  insert.run(digest,'alice',address,digest,1,today,500,'confirmed',JSON.stringify({intentDigest:digest,address,route:{inputRaw:'1000000'}}),hash,stamp,stamp);
  insert.run(digest2,'alice',address,digest2,1,today,300,'attempting',JSON.stringify({intentDigest:digest2,address,route:{inputRaw:'2000000'}}),null,stamp,stamp);
  const evidence=await listSpendEvidence(db,'alice',address);
  assert.equal(evidence?.filledCents,500);
  assert.equal(evidence?.pendingCents,300);
  assert.equal(evidence?.reservedRaw,'2000000');
  assert.deepEqual(evidence?.knownHashes,[hash]);
  assert.deepEqual(evidence?.confirmedHashes,[hash]);
 }finally{sql.close();}});
test('wallet receipt saves are atomic, retryable, owner scoped and survive UTC midnight',async()=>{const {recordWalletSubmission}=await import('./execution-attempts.ts');const {db,sql}=fixture();try{const p=plan(1);await reserveAttempt(db,p,now);const tomorrow=new Date('2026-09-28T00:00:01Z');assert.equal(await recordWalletSubmission(db,'bob',p.intentDigest,hash,tomorrow),false);assert.equal(await recordWalletSubmission(db,'alice',p.intentDigest,hash,tomorrow),true);assert.equal(await recordWalletSubmission(db,'alice',p.intentDigest,hash,tomorrow),true);assert.equal(await recordWalletSubmission(db,'alice',p.intentDigest,'0x'+'c'.repeat(64),tomorrow),false);assert.equal((await getAttempt(db,'alice',p.intentDigest))?.state,'submitted');assert.equal(await cancelReservation(db,'alice',p.intentDigest,tomorrow),false);}finally{sql.close();}});


test('sales reserve stock inventory without consuming or refunding the buy budget',async()=>{
 const {db,sql}=fixture();try{
  const token=('0x'+'3'.repeat(40)) as `0x${string}`;
  const route={id:'sale-ledger',side:'sell',chainId:4663,address,token,settlement:VENUE.settlement,inputRaw:'1000000000000000',minimumOutputRaw:'100',best:{state:'quoted',outputRaw:'120',fee:3000,tickSpacing:60,poolId:poolIdentity(token,3000,60).poolId},blockHash:'0x'+'a'.repeat(64),expiresAt:new Date(now.getTime()+25000).toISOString()} as RouteEvidence;
  const candidate=routerCandidate(route,1),sale={...plan(10),intentDigest:candidate.intentDigest,candidate,route};
  assert.equal(await reserveAttempt(db,sale,now),true);
  assert.equal(sql.prepare('SELECT amount_cents FROM autonomy_spends WHERE intent_id=?').get(sale.intentDigest)?.amount_cents,0);
  await beginAttempt(db,'alice',sale.intentDigest,1,now);
  const pending=await listSpendEvidence(db,'alice',address,now);
  assert.equal(pending?.reservedRaw,'0');assert.equal(pending?.pendingCents,0);assert.equal(pending?.reservedByToken?.[token],route.inputRaw);
  await recordSubmission(db,'alice',sale.intentDigest,hash,now);
  await settleAttempt(db,'alice',sale.intentDigest,{hash,canonicalFinalized:true,outcome:'verified_fill',intentDigest:sale.intentDigest},now);
  const done=await listSpendEvidence(db,'alice',address,now);
  assert.equal(done?.filledCents,0);assert.deepEqual(done?.reservedByToken,{});
  assert.equal(await reserveAttempt(db,plan(11,'alice',100),now),true);
  assert.equal(await reserveAttempt(db,plan(12,'alice',1),now),false);
 }finally{sql.close();}
});


test('one news article cannot reserve two intents, including unknown and confirmed outcomes',async()=>{
 const {db,sql}=fixture();try{
  const first={...plan(20,'alice',20),newsEventId:'alpaca:123'};
  assert.equal(await reserveAttempt(db,first,now),true);
  assert.equal(await reserveAttempt(db,{...plan(21,'alice',20),newsEventId:first.newsEventId},now),false);
  await beginAttempt(db,'alice',first.intentDigest,1,now);await recordUnknown(db,'alice',first.intentDigest,now);
  assert.equal(await reserveAttempt(db,{...plan(22,'alice',20),newsEventId:first.newsEventId},now),false);
  await recordSubmission(db,'alice',first.intentDigest,hash,now);await settleAttempt(db,'alice',first.intentDigest,{hash,canonicalFinalized:true,outcome:'verified_fill',intentDigest:first.intentDigest},now);
  assert.equal(await reserveAttempt(db,{...plan(23,'alice',20),newsEventId:first.newsEventId},now),false);
  assert.equal(await reserveAttempt(db,{...plan(24,'bob',20),newsEventId:first.newsEventId},now),true);
 }finally{sql.close();}
});
