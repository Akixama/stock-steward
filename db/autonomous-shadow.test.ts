import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {recordShadowExecution,type ShadowClaim} from './autonomous-shadow.ts';
import {publicRunExecution,runExecutionMessage} from '../lib/autonomous-run-status.ts';

test('execution receipts are owner/claim bound, durable before execution and cannot be overwritten',async()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../drizzle/0020_autonomous_shadow.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../drizzle/0043_multiple_rules.sql',import.meta.url),'utf8'));
 const db={prepare(query:string){let args:unknown[]=[];const statement={bind(...values:unknown[]){args=values;return statement;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...args as never[]).changes)}};}};return statement;}} as unknown as D1Database;
 const claim={id:'run',token:'claim',plan:{owner_ref:'alice',rule_id:'main',revision:1}} as ShadowClaim;
 sql.prepare("INSERT INTO autonomous_shadow_runs(id,owner_ref,revision,due_at,claim_token,state,decision_json,created_at) VALUES('run','alice',1,'due','claim','completed',?,'now')").run(JSON.stringify({status:'would_trigger'}));
 try{
  const checking={state:'checking' as const,why:'Checking.'};
  assert.equal(await recordShadowExecution(db,{...claim,plan:{...claim.plan,owner_ref:'mallory'}},checking),false);
  assert.equal(await recordShadowExecution(db,{...claim,token:'stale'},checking),false);
  assert.equal(await recordShadowExecution(db,claim,{state:'blocked',why:'No grant.'}),false);
  assert.equal(await recordShadowExecution(db,claim,checking),true);
  assert.equal(await recordShadowExecution(db,claim,checking),false);
  const pending=JSON.parse(String(sql.prepare('SELECT decision_json FROM autonomous_shadow_runs').get()!.decision_json));
  assert.match(runExecutionMessage(pending.execution),/outcome has not been recorded/);
  const hash=('0x'+'a'.repeat(64)) as `0x${string}`;
  assert.equal(await recordShadowExecution(db,claim,{state:'unknown',why:'Response lost.',hash}),true);
  assert.equal(await recordShadowExecution(db,claim,{state:'submitted',why:'Late response.',hash}),false);
  const saved=JSON.parse(String(sql.prepare('SELECT decision_json FROM autonomous_shadow_runs').get()!.decision_json));
  assert.equal(saved.execution.hash,hash);
  assert.match(runExecutionMessage(saved.execution),/do not submit/);
 }finally{sql.close();}
});

test('public execution receipts reject missing submission hashes and discard private fields',()=>{
 assert.throws(()=>publicRunExecution({state:'submitted',why:'Sent.'}),/hash/);
 assert.throws(()=>publicRunExecution({state:'unknown',why:'Uncertain.',hash:'0x1234'}),/hash/);
 const receipt=publicRunExecution({state:'blocked',why:'Review needed.',raw:'secret',privateKey:'secret'} as Parameters<typeof publicRunExecution>[0]);
 assert.deepEqual(receipt,{state:'blocked',why:'Review needed.'});
 assert.match(runExecutionMessage({state:'submitted',why:'Sent.',hash:('0x'+'a'.repeat(64)) as `0x${string}`}),/awaiting receipt verification/);
 assert.match(runExecutionMessage(),/Preview only/);
});
