import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {collectAutonomousIncidents,listAutonomousIncidents,acknowledgeAutonomousIncident} from './autonomous-incidents.ts';

test('delayed and unknown purchase alerts are deduplicated, owner scoped and do not release funds',async()=>{
 const sql=new DatabaseSync(':memory:');
 for(const migration of ['0020_autonomous_shadow.sql','0021_autonomous_transaction_journal.sql','0023_autonomous_journal_settlement.sql','0024_autonomous_incidents.sql'])sql.exec(readFileSync(new URL('../drizzle/'+migration,import.meta.url),'utf8'));
 const db={prepare(query:string){let args:unknown[]=[];const s={bind(...values:unknown[]){args=values;return s;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args as never[]).changes)}};},async all(){return {results:sql.prepare(query).all(...args as never[])};}};return s;},async batch(statements:{run():Promise<unknown>}[]){const result=[];for(const statement of statements)result.push(await statement.run());return result;}} as unknown as D1Database;
 const now=new Date('2026-10-12T12:00:00Z');
 sql.prepare("INSERT INTO autonomous_transaction_journal VALUES('intent','alice','session',0,'hash','raw','submitted','2026-10-12T11:54:00Z','2026-10-12T11:54:00Z',NULL)").run();
 sql.prepare("INSERT INTO autonomous_account_locks VALUES('safe','alice','intent','now')").run();
 try{
  assert.equal(await collectAutonomousIncidents(db,now),1);
  assert.equal(await collectAutonomousIncidents(db,now),0);
  assert.deepEqual(await listAutonomousIncidents(db,'mallory'),[]);
  const incidents=await listAutonomousIncidents(db,'alice') as {id:string;kind:string}[];
  assert.equal(incidents[0].kind,'receipt_delayed');
  assert.equal(await acknowledgeAutonomousIncident(db,'mallory',incidents[0].id,now),false);
  assert.equal(await acknowledgeAutonomousIncident(db,'alice',incidents[0].id,now),true);
  sql.prepare("UPDATE autonomous_transaction_journal SET state='unknown'").run();
  assert.equal(await collectAutonomousIncidents(db,now),1);
  assert.equal(sql.prepare('SELECT count(*) AS n FROM autonomous_account_locks').get()!.n,1);
  sql.prepare("UPDATE autonomous_transaction_journal SET settled_state='confirmed'").run();
  assert.equal(await collectAutonomousIncidents(db,now),1);
  assert.equal(await collectAutonomousIncidents(db,now),0);
 }finally{sql.close();}
});
