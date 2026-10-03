import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {loadPractice,savePractice,commandPractice,tickPracticeSessions} from './practice-sessions.ts';import {newPracticeSession} from '../lib/practice-session.ts';import type {Strategy} from '../lib/strategy.ts';import type {Mandate} from '../lib/decision.ts';
function database(){const sql=new DatabaseSync(':memory:');sql.exec('CREATE TABLE practice_sessions(owner_ref TEXT PRIMARY KEY,revision INTEGER NOT NULL,session_json TEXT NOT NULL,background INTEGER NOT NULL,next_due_at INTEGER NOT NULL); CREATE TABLE mandates(owner_ref TEXT,version INTEGER,policy_json TEXT,created_at TEXT);');const db={prepare(q:string){let args:(string|number|null)[]=[];const stmt={bind(...values:typeof args){args=values;return stmt;},async first(){return sql.prepare(q).get(...args)??null;},async all(){return {results:sql.prepare(q).all(...args)};},async run(){return {meta:{changes:Number(sql.prepare(q).run(...args).changes)}};}};return stmt;}} as unknown as D1Database;return {sql,db};}
const now=Date.UTC(2026,8,28,12);const m={version:1,allowedSymbols:['AAPL'],maxOrderCents:200,maxDailyBuyCents:200,maxPositionBps:2000,requireApproval:true} as Mandate;const strategy:Strategy={version:1,kind:'scheduled',direction:'Buy $1 daily',symbol:'AAPL',amountCents:100,reserveCents:2000,intervalHours:24,thresholdCents:18000,targetBps:1000,driftBps:200,maxMovementBps:500,mode:'automatic'};
test('real SQLite persistence isolates owners and fences duplicate commands',async()=>{const {db,sql}=database();sql.prepare('INSERT INTO mandates VALUES(?,?,?,?)').run('a',1,JSON.stringify(m),new Date(now).toISOString());let s=await commandPractice(db,'a',0,{action:'confirm',strategy},m,now);s=await commandPractice(db,'a',s.revision,{action:'authorize'},m,now);const stale=structuredClone(s);s=await commandPractice(db,'a',s.revision,{action:'run'},m,now);assert.equal((await loadPractice(db,'a')).account.cashCents,99900);await assert.rejects(()=>commandPractice(db,'a',stale.revision,{action:'run'},m,now));assert.equal((await loadPractice(db,'b',now)).account.cashCents,100000);assert.equal(await savePractice(db,'a',stale,{...stale,account:{...stale.account,cashCents:0}}),false);sql.close();});
test('background worker cannot commit across pause or mandate changes',async()=>{const {db,sql}=database();sql.prepare('INSERT INTO mandates VALUES(?,?,?,?)').run('a',1,JSON.stringify(m),new Date(now).toISOString());let s=await commandPractice(db,'a',0,{action:'confirm',strategy},m,now);for(const action of [{action:'authorize'},{action:'start'},{action:'background',enabled:true}] as const)s=await commandPractice(db,'a',s.revision,action,m,now);assert.equal((await tickPracticeSessions(db,now)).updated,1);s=await loadPractice(db,'a');assert.equal(s.account.cashCents,99900);const workerSnapshot=structuredClone(s);s=await commandPractice(db,'a',s.revision,{action:'pause'},m,now+1);assert.equal(await savePractice(db,'a',workerSnapshot,{...workerSnapshot,account:{...workerSnapshot.account,cashCents:99800}}),false);assert.equal((await tickPracticeSessions(db,now+900000)).checked,0);const old=structuredClone(s);sql.prepare('INSERT INTO mandates VALUES(?,?,?,?)').run('a',2,JSON.stringify({...m,version:2}),new Date(now).toISOString());assert.equal(await savePractice(db,'a',s,{...s,account:{...s.account,cashCents:0}}),false);assert.equal((await loadPractice(db,'a')).account.cashCents,old.account.cashCents);sql.close();});

test('unattended background saves once and revocation blocks later wakes and stale writes',async()=>{
 const {db,sql}=database();
 sql.prepare('INSERT INTO mandates VALUES(?,?,?,?)').run('a',1,JSON.stringify(m),new Date(now).toISOString());
 let s=await commandPractice(db,'a',0,{action:'confirm',strategy},m,now);
 for(const action of [{action:'authorize'},{action:'start'},{action:'background',enabled:true}] as const)s=await commandPractice(db,'a',s.revision,action,m,now);
 const first=await tickPracticeSessions(db,now);
 assert.equal(first.updated,1);assert.equal(first.transactionsSent,0);
 const saved=await loadPractice(db,'a');assert.equal(saved.account.cashCents,99900);
 assert.equal(saved.receipts[0].trigger,'background');
 assert.equal((await tickPracticeSessions(db,now)).checked,0);
 s=await commandPractice(db,'a',saved.revision,{action:'revoke'},m,now+1);
 assert.equal(s.background,false);assert.equal(s.account.grant,false);
 assert.equal(await savePractice(db,'a',saved,{...saved,account:{...saved.account,cashCents:99800}}),false);
 assert.equal((await tickPracticeSessions(db,now+900000)).checked,0);
 assert.equal((await loadPractice(db,'a')).account.cashCents,99900);
 sql.close();
});

