import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {buysSinceCents,outflowSince} from './position-activity.ts';

function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE execution_attempts(id TEXT,owner_ref TEXT,address TEXT,amount_cents INTEGER,state TEXT,plan_json TEXT,created_at TEXT)');
 sql.exec('CREATE TABLE wallet_action_attempts(id TEXT,owner_ref TEXT,safe TEXT,state TEXT,created_at TEXT)');
 const db={prepare(query:string){let args:unknown[]=[];const stmt={bind(...values:unknown[]){args=values;return stmt;},async first<T>(){return sql.prepare(query).get(...args as never[]) as T|null??null;}};return stmt;}} as unknown as D1Database;
 return {sql,db};
}
const SAFE='0xAbC0000000000000000000000000000000000001';
test('buys since a value check count only this owner, wallet, stock, time and live states',async()=>{
 const {sql,db}=database();try{
  const add=(owner:string,address:string,cents:number,state:string,symbol:string,at:string)=>sql.prepare('INSERT INTO execution_attempts VALUES(?,?,?,?,?,?,?)').run(crypto.randomUUID(),owner,address,cents,state,JSON.stringify({route:{symbol}}),at);
  add('alice',SAFE.toLowerCase(),1000,'confirmed','MSFT','2026-10-24T11:58:00Z');
  add('alice',SAFE,1000,'reserved','MSFT','2026-10-24T11:59:00Z');
  add('alice',SAFE,1000,'reverted','MSFT','2026-10-24T11:59:30Z');
  add('alice',SAFE,1000,'confirmed','AAPL','2026-10-24T11:59:30Z');
  add('alice',SAFE,1000,'confirmed','MSFT','2026-10-24T11:00:00Z');
  add('bob',SAFE,1000,'confirmed','MSFT','2026-10-24T11:59:00Z');
  assert.equal(await buysSinceCents(db,'alice',SAFE,'MSFT','2026-10-24T11:55:00Z'),2000);
  assert.equal(await buysSinceCents(db,'alice',SAFE,'NVDA','2026-10-24T11:55:00Z'),0);
 }finally{sql.close();}
});
test('any non-reverted sale or send since the check is reported',async()=>{
 const {sql,db}=database();try{
  assert.equal(await outflowSince(db,'alice',SAFE,'2026-10-24T11:55:00Z'),false);
  sql.prepare('INSERT INTO wallet_action_attempts VALUES(?,?,?,?,?)').run('1','alice',SAFE,'reverted','2026-10-24T11:58:00Z');
  sql.prepare('INSERT INTO wallet_action_attempts VALUES(?,?,?,?,?)').run('2','alice',SAFE,'confirmed','2026-10-24T11:00:00Z');
  assert.equal(await outflowSince(db,'alice',SAFE,'2026-10-24T11:55:00Z'),false);
  sql.prepare('INSERT INTO wallet_action_attempts VALUES(?,?,?,?,?)').run('3','alice',SAFE,'submitted','2026-10-24T11:58:00Z');
  assert.equal(await outflowSince(db,'alice',SAFE,'2026-10-24T11:55:00Z'),true);
 }finally{sql.close();}
});
