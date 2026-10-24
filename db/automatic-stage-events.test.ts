import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {saveAutomaticEvent,saveRuleProposal,automaticEvents,claimProposalReview,type AutomaticStageEvent} from './automatic-stage-events.ts';
import {queueAutomaticPush} from '../lib/automatic-stage-push.ts';

function database(){
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE autonomous_shadow_plans(owner_ref TEXT,rule_id TEXT NOT NULL DEFAULT \'main\',revision INTEGER,enabled INTEGER,lease_token TEXT,lease_until TEXT,PRIMARY KEY(owner_ref,rule_id))');
 sql.exec('CREATE TABLE autonomous_shadow_runs(id TEXT PRIMARY KEY,revision INTEGER,rule_id TEXT NOT NULL DEFAULT \'main\')');
 sql.exec("INSERT INTO autonomous_shadow_plans(owner_ref,revision,enabled,lease_token,lease_until) VALUES('alice',3,1,'old-lease','2026-10-22T00:00:00Z')");
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
test('no idea is saved while the plan is paused or after it changed',async()=>{
 const {sql,db}=database();try{
  // The migration pauses the plan; a paused plan never gets an idea.
  const proposal=event('proposal');sql.prepare('INSERT INTO autonomous_shadow_runs(id,revision) VALUES(?,?)').run(proposal.run_id,3);
  assert.equal(await saveRuleProposal(db,proposal,3,new Date('2026-10-21T00:00:00Z')),false);
  // Pause then resume bumps the revision: a check from the old revision saves nothing.
  sql.exec("UPDATE autonomous_shadow_plans SET enabled=1,revision=5");
  assert.equal(await saveRuleProposal(db,proposal,3,new Date('2026-10-21T00:00:00Z')),false);
  // Another owner's running plan does not count.
  sql.exec("UPDATE autonomous_shadow_plans SET owner_ref='bob',revision=3");
  assert.equal(await saveRuleProposal(db,proposal,3,new Date('2026-10-21T00:00:00Z')),false);
  assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM automatic_stage_events').get()!.n),0);
  sql.exec("UPDATE autonomous_shadow_plans SET owner_ref='alice'");
  assert.equal(await saveRuleProposal(db,proposal,3,new Date('2026-10-21T00:00:00Z')),true);
 }finally{sql.close();}
});
test('a live idea is not duplicated for the same running rule',async()=>{
 const {sql,db}=database();try{
  sql.exec('UPDATE autonomous_shadow_plans SET enabled=1');
  const first=event('proposal'),secondId='0x'+'b'.repeat(64);
  const second={...first,id:`${secondId}:proposal`,run_id:secondId,created_at:'2026-10-21T00:02:00.000Z'};
  sql.prepare('INSERT INTO autonomous_shadow_runs(id,revision) VALUES(?,?)').run(first.run_id,3);
  sql.prepare('INSERT INTO autonomous_shadow_runs(id,revision) VALUES(?,?)').run(second.run_id,3);
  assert.equal(await saveRuleProposal(db,first,3,new Date('2026-10-21T00:00:00Z')),true);
  assert.equal(await saveRuleProposal(db,second,3,new Date('2026-10-21T00:02:00Z')),false);
  assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM automatic_stage_events').get()!.n),1);
  assert.equal(await saveRuleProposal(db,second,3,new Date('2026-10-21T00:16:00Z')),true);
  assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM automatic_stage_events').get()!.n),2);
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

test('idea to Buy: opens once, carries its amount, and flags a saved amount that differs',async()=>{
 const {buyIdeaFromClaim,buyIdeaAmount}=await import('../lib/buy-idea.ts');
 const {sql,db}=database();try{
  sql.exec('UPDATE autonomous_shadow_plans SET enabled=1');
  const proposal={...event('proposal'),amount_cents:1000};sql.prepare('INSERT INTO autonomous_shadow_runs(id,revision) VALUES(?,?)').run(proposal.run_id,3);
  assert.equal(await saveRuleProposal(db,proposal,3,new Date('2026-10-21T00:00:00Z')),true);
  const idea=buyIdeaFromClaim(await claimProposalReview(db,'alice',proposal.id,new Date('2026-10-21T00:05:00Z')));
  assert.deepEqual(idea,{symbol:'AAPL',amountCents:1000});
  // Same saved amount: no acknowledgement needed. Different saved amount: the review says which amount it uses.
  assert.equal(buyIdeaAmount(idea.amountCents,1000).differs,false);
  const differs=buyIdeaAmount(idea.amountCents,500);
  assert.equal(differs.differs,true);assert.match(differs.label,/will use \$5\.00, not the idea amount/);
  // Opened ideas and expired ideas never open again, so Buy cannot be reached twice from one idea.
  assert.equal(await claimProposalReview(db,'alice',proposal.id,new Date('2026-10-21T00:06:00Z')),null);
  const late={...proposal,id:`${'0x'+'d'.repeat(64)}:proposal`,run_id:'0x'+'d'.repeat(64)};await saveAutomaticEvent(db,late);
  assert.equal(await claimProposalReview(db,'alice',late.id,new Date('2026-10-21T00:15:00Z')),null);
 }finally{sql.close();}
});
