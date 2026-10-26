import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
import {tickAgents,AGENT_RULE_ID,type Holdings} from './ai-agent-worker.ts';
import {saveAgent,agentLog,getAgent} from '../db/ai-agent.ts';
import {getShadowPlan} from '../db/autonomous-shadow.ts';
import type {AgentSettings} from './ai-agent.ts';

const NVDA='0x00000000000000000000000000000000000000a1',TSLA='0x00000000000000000000000000000000000000b2',SAFE='0x00000000000000000000000000000000000000cc';
function fixture(armed=true){
 const sql=new DatabaseSync(':memory:');const dir=new URL('../drizzle/',import.meta.url);
 for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())for(const part of readFileSync(new URL(f,dir),'utf8').split('--> statement-breakpoint'))sql.exec(part);
 const now='2026-10-26T12:00:00.000Z';
 sql.prepare('INSERT INTO mandates VALUES(?,?,?,?)').run('alice',1,JSON.stringify({version:1,allowedSymbols:['NVDA','TSLA'],maxOrderCents:2500,maxDailyBuyCents:10000,maxPositionBps:10000}),now);
 sql.prepare('INSERT INTO wallet_ownership VALUES(?,?,?,?,?,?,?,?)').run('alice',SAFE,'c','m',now,now,now,'safe');
 sql.prepare('INSERT INTO autonomous_session_grants(owner_ref,id,state,session_address,mandate_version,policy_json,lease_json,transaction_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('alice','g1','verified','0x01',1,JSON.stringify({account:SAFE,sales:[{token:TSLA}]}),'{}','{}',now);
 sql.prepare('INSERT INTO autonomous_activation VALUES(?,?,?,?,?,?,?)').run('alice','g1',armed?'armed':'paused','{}','0x',now,now);
 for(const [symbol,base] of [['NVDA',18000],['TSLA',25000]] as const)for(const [ago,mult] of [[7*86400,1],[86400,1.05],[60,0.97]] as const)
  sql.prepare('INSERT INTO market_price_samples VALUES(?,?,?,?)').run(symbol,new Date(Date.parse(now)-ago*1000).toISOString(),Math.round(base*mult)-10,Math.round(base*mult)+10);
 const db={prepare(q:string){let a:unknown[]=[];const s={bind(...v:unknown[]){a=v;return s;},async run(){return {meta:{changes:Number(sql.prepare(q).run(...a as never[]).changes)}};},async first(){return sql.prepare(q).get(...a as never[])??null;},async all(){return {results:sql.prepare(q).all(...a as never[])};}};return s;}} as unknown as D1Database;
 return {db,now:new Date(now)};
}
const settings:AgentSettings={version:1,symbols:['NVDA','TSLA'],style:'balanced',intervalMinutes:60,note:''};
const holdings=async():Promise<Holdings>=>({cashCents:20000,held:{TSLA:{quantity:0.4,token:TSLA},NVDA:{quantity:0,token:NVDA}}});

test('an armed agent asks the AI, the decision is checked, queued as a one-shot rule and logged',async()=>{
 const {db,now}=fixture();await saveAgent(db,'alice',settings,true,now);
 let seen='';
 const r=await tickAgents(db,{ask:async(_s,u)=>{seen=u;return {action:'buy',symbol:'NVDA',reason:'Down 3% today.'};},holdings,maxOrderCents:10000,now});
 assert.equal(r.buys,1);assert.doesNotMatch(seen,/0x/);
 const plan=await getShadowPlan(db,'alice',AGENT_RULE_ID);assert.equal(plan?.enabled,1);
 const rule=JSON.parse(plan!.rule_json);assert.equal(rule.symbol,'NVDA');assert.equal(rule.amountCents,2500,'owner Limit, not the platform cap');
 assert.equal((await agentLog(db,'alice'))[0].action,'buy');
 assert.equal((await getAgent(db,'alice'))!.next_run_at,new Date(now.getTime()+3600_000).toISOString());
 assert.equal((await tickAgents(db,{ask:async()=>{throw Error('not due');},holdings,maxOrderCents:10000,now})).due,0,'not due again until the interval passes');
});
test('a hold, a bad answer or an AI outage parks the queued rule so nothing repeats',async()=>{
 const {db,now}=fixture();await saveAgent(db,'alice',settings,true,now);
 await tickAgents(db,{ask:async()=>({action:'sell',symbol:'TSLA',reason:'Up 5% this week.'}),holdings,maxOrderCents:10000,now});
 assert.equal(JSON.parse((await getShadowPlan(db,'alice',AGENT_RULE_ID))!.rule_json).kind,'sell_scheduled');
 const later=new Date(now.getTime()+3600_000);
 await tickAgents(db,{ask:async()=>{throw Error('AI down');},holdings,maxOrderCents:10000,now:later});
 assert.equal((await getShadowPlan(db,'alice',AGENT_RULE_ID))!.enabled,0);
 assert.equal((await agentLog(db,'alice'))[0].blocked,'AI unavailable');
});
test('without armed automatic mode the agent never calls the AI',async()=>{
 const {db,now}=fixture(false);await saveAgent(db,'alice',settings,true,now);
 const r=await tickAgents(db,{ask:async()=>{throw Error('must not be called');},holdings,maxOrderCents:10000,now});
 assert.equal(r.skipped,1);assert.equal((await agentLog(db,'alice')).length,0);
});
test('Ask-me mode works without a permission: buys queue as ideas, sells go to the inbox',async()=>{
 const {db,now}=fixture(false);await saveAgent(db,'alice',{...settings,mode:'ask',intervalMinutes:15},true,now);
 const r=await tickAgents(db,{ask:async()=>({action:'buy',symbol:'NVDA',reason:'Down 3% today.'}),holdings,maxOrderCents:1000,now});
 assert.equal(r.buys,1);
 const plan=await getShadowPlan(db,'alice',AGENT_RULE_ID);assert.equal(JSON.parse(plan!.rule_json).amountCents,2500,'your own Limit; you sign it');
 assert.equal((await agentLog(db,'alice'))[0].mode,'ask');
 const later=new Date(now.getTime()+15*60_000);
 await tickAgents(db,{ask:async()=>({action:'sell',symbol:'TSLA',reason:'Up 5% this week.'}),holdings,maxOrderCents:1000,now:later});
 assert.equal((await getShadowPlan(db,'alice',AGENT_RULE_ID))!.enabled,0,'a sell idea is never queued to trade');
 const inbox=await db.prepare('SELECT title FROM notification_inbox WHERE owner_ref=?').bind('alice').all<{title:string}>();
 assert.match(inbox.results[0].title,/sell idea for TSLA/);
});
