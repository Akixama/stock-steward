import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {reserveWalletAction,latestWalletAction,walletActionView,type WalletAction} from './wallet-action-attempts.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../drizzle/0034_wallet_action_attempts.sql',import.meta.url),'utf8'));
 sql.exec('CREATE TABLE autonomy_spends(owner_ref TEXT,execution_day TEXT,amount_cents INTEGER,state TEXT)');
 const db={prepare(query:string){let values:unknown[]=[];const statement={bind(...args:unknown[]){values=args;return statement;},async run(){const result=sql.prepare(query).run(...values as (string|number|null)[]);return {meta:{changes:Number(result.changes)}};},async first(){return sql.prepare(query).get(...values as (string|number|null)[])??null;},async all(){return {results:sql.prepare(query).all(...values as (string|number|null)[])}}};return statement;}} as unknown as D1Database;
 return {sql,db};
}
const action:WalletAction={owner:'alice',ownerAddress:'0x'+'a'.repeat(40),safe:'0x'+'b'.repeat(40),kind:'transfer',symbol:'USDG',quantity:'2',amountCents:200,transaction:{from:'0x'+'a'.repeat(40),to:'0x'+'b'.repeat(40),data:'0x1234',value:'0x0'}};
test('wallet action is saved once before sending and daily cap includes pending actions',async()=>{
 const {sql,db}=fixture();try{
  const id=await reserveWalletAction(db,action,500);assert.ok(id);
  assert.equal(await reserveWalletAction(db,action,500),null);
  assert.equal((await latestWalletAction(db,'alice',action.safe))?.hash,null);
  const other={...action,kind:'sell' as const,symbol:'AAPL',quantity:'1',amountCents:300,transaction:{...action.transaction,data:'0x5678'}};
  assert.ok(await reserveWalletAction(db,other,500));
  assert.equal(await reserveWalletAction(db,{...other,symbol:'MSFT',transaction:{...other.transaction,data:'0x9999'}},500),null);
 }finally{sql.close();}
});
test('public action cap counts buy reservations from the same day',async()=>{
 const {sql,db}=fixture();try{
  sql.prepare('INSERT INTO autonomy_spends VALUES (?,?,?,?)').run('alice',new Date().toISOString().slice(0,10),400,'reserved');
  assert.equal(await reserveWalletAction(db,action,500),null);
  assert.ok(await reserveWalletAction(db,{...action,amountCents:100},500));
 }finally{sql.close();}
});
test('reload after confirmed transfer offers no resumable hash and keeps history',async()=>{
 const {sql,db}=fixture();try{
  const id=await reserveWalletAction(db,action,500);assert.ok(id);
  const hash='0x'+'1'.repeat(64);
  sql.prepare("UPDATE wallet_action_attempts SET state='confirmed',transaction_hash=? WHERE id=?").run(hash,id);
  const view=await walletActionView(db,'alice',action.safe,'transfer');
  assert.equal(view.latest,null);assert.equal(view.history.length,1);
  assert.equal((view.history[0] as {hash:string}).hash,hash);
  assert.ok(await reserveWalletAction(db,{...action,quantity:'10',transaction:{...action.transaction,data:'0xabcd'}},500));
 }finally{sql.close();}
});
