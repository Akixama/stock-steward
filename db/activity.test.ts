import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ownerActivity,activityStateLabel} from './activity.ts';

function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec("CREATE TABLE execution_attempts(id TEXT,owner_ref TEXT,amount_cents INTEGER,state TEXT,plan_json TEXT,transaction_hash TEXT,created_at TEXT)");
 sql.exec("CREATE TABLE wallet_action_attempts(id TEXT,owner_ref TEXT,kind TEXT,symbol TEXT,amount_cents INTEGER,state TEXT,transaction_hash TEXT,created_at TEXT)");
 sql.exec("CREATE TABLE automatic_stage_events(id TEXT,owner_ref TEXT,kind TEXT,symbol TEXT,amount_cents INTEGER,status TEXT,created_at TEXT,expires_at TEXT)");
 const db={prepare(query:string){let args:unknown[]=[];const stmt={bind(...values:unknown[]){args=values;return stmt;},async all<T>(){return {results:sql.prepare(query).all(...args as never[]) as T[]};}};return stmt;}} as unknown as D1Database;
 return {sql,db};
}
test('activity lists only this owner, newest first, across buys, sells, sends and ideas',async()=>{
 const {sql,db}=database();try{
  sql.prepare('INSERT INTO execution_attempts VALUES(?,?,?,?,?,?,?)').run('b1','alice',1000,'confirmed',JSON.stringify({route:{symbol:'AAPL'}}),'0xabc','2026-10-20T10:00:00Z');
  sql.prepare('INSERT INTO execution_attempts VALUES(?,?,?,?,?,?,?)').run('b2','bob',900,'confirmed','{}',null,'2026-10-22T10:00:00Z');
  sql.prepare('INSERT INTO wallet_action_attempts VALUES(?,?,?,?,?,?,?,?)').run('s1','alice','sell','MSFT',1200,'submitted','0xdef','2026-10-21T10:00:00Z');
  sql.prepare('INSERT INTO wallet_action_attempts VALUES(?,?,?,?,?,?,?,?)').run('t1','alice','transfer','AAPL',0,'confirmed','0x123','2026-10-21T12:00:00Z');
  sql.prepare('INSERT INTO automatic_stage_events VALUES(?,?,?,?,?,?,?,?)').run('i1','alice','proposal','AAPL',500,'proposed','2026-10-22T09:00:00Z','2026-10-22T09:15:00Z');
  sql.prepare('INSERT INTO automatic_stage_events VALUES(?,?,?,?,?,?,?,?)').run('a1','alice','auto_action','AAPL',100,'blocked','2026-10-22T11:00:00Z','2026-10-23T11:00:00Z');
  const items=await ownerActivity(db,'alice');
  assert.deepEqual(items.map(item=>item.kind),['idea','send','sell','buy']);
  assert.equal(items[0].state,'expired');assert.equal(items[1].amountCents,null);assert.equal(items[3].symbol,'AAPL');
  assert.equal(activityStateLabel('confirmed'),'Confirmed');assert.equal(activityStateLabel('submitted'),'Sent · checking');
 }finally{sql.close();}
});
