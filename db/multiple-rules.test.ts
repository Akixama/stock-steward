import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {saveShadowPlan,getShadowPlan,listShadowPlans,deleteShadowPlan,controlShadowPlan,dueShadowPlans,claimShadowPlan,MAX_RULES} from './autonomous-shadow.ts';
import type {AutonomousRule} from '../lib/autonomous-live.ts';

function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const f of ['0020_autonomous_shadow.sql'])sql.exec(readFileSync(new URL('../drizzle/'+f,import.meta.url),'utf8'));
 // An existing single rule from before v2 must survive the migration.
 sql.exec("INSERT INTO autonomous_shadow_plans(owner_ref,revision,rule_json,enabled,next_due_at,updated_at) VALUES('alice',4,'"+JSON.stringify({version:1,symbol:'AAPL',amountCents:1000,kind:'threshold',intervalMinutes:15,thresholdCents:35000})+"',1,'2026-10-24T00:00:00.000Z','2026-10-23T00:00:00.000Z')");
 sql.exec(readFileSync(new URL('../drizzle/0043_multiple_rules.sql',import.meta.url),'utf8'));
 const db={prepare(q:string){let a:unknown[]=[];const s={bind(...v:unknown[]){a=v;return s;},async run(){return {meta:{changes:Number(sql.prepare(q).run(...a as never[]).changes)}};},async first(){return sql.prepare(q).get(...a as never[])??null;},async all(){return {results:sql.prepare(q).all(...a as never[])};}};return s;},async batch(st:{run():Promise<unknown>}[]){sql.exec('BEGIN');try{const r=[];for(const s of st)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}} as unknown as D1Database;
 return {sql,db};
}
const rule=(symbol:string):AutonomousRule=>({version:1,symbol,amountCents:500,kind:'threshold',intervalMinutes:15,thresholdCents:10000});
const now=new Date('2026-10-24T12:00:00Z');

test('the old single rule becomes "main" with its revision and schedule intact',async()=>{
 const {db}=fixture();const main=await getShadowPlan(db,'alice');
 assert.equal(main?.rule_id,'main');assert.equal(main?.revision,4);assert.equal(main?.enabled,1);
});
test('several rules run side by side, each claimed once with its own run id',async()=>{
 const {db}=fixture();
 assert.equal(await saveShadowPlan(db,'alice',0,rule('NVDA'),true,now,'r-nvda'),true);
 assert.equal(await saveShadowPlan(db,'alice',0,rule('TSLA'),true,now,'r-tsla'),true);
 assert.deepEqual((await listShadowPlans(db,'alice')).map(p=>p.rule_id),['main','r-nvda','r-tsla']);
 const due=await dueShadowPlans(db,now,'alice');assert.equal(due.length,3);
 const claims=[];for(const p of due)claims.push(await claimShadowPlan(db,p,now));
 assert.equal(new Set(claims.map(c=>c!.id)).size,3,'distinct run ids');
 assert.equal(await claimShadowPlan(db,due[1],now),null,'never twice');
});
test('rules are paused, edited and removed one at a time, and capped at six',async()=>{
 const {db}=fixture();
 await saveShadowPlan(db,'alice',0,rule('NVDA'),true,now,'r-nvda');
 assert.equal(await controlShadowPlan(db,'alice',1,false,now,'r-nvda'),true);
 assert.equal((await getShadowPlan(db,'alice','r-nvda'))!.enabled,0);
 assert.equal((await getShadowPlan(db,'alice'))!.enabled,1,'main untouched');
 assert.equal(await saveShadowPlan(db,'alice',2,rule('AMD'),true,now,'r-nvda'),true);
 assert.equal((await getShadowPlan(db,'alice','r-nvda'))!.revision,3);
 assert.equal(await deleteShadowPlan(db,'alice','r-nvda',2),false,'stale revision');
 assert.equal(await deleteShadowPlan(db,'alice','r-nvda',3),true);
 for(let i=0;i<MAX_RULES-1;i++)await saveShadowPlan(db,'alice',0,rule('AAPL'),false,now,`r${i}`);
 await assert.rejects(saveShadowPlan(db,'alice',0,rule('AAPL'),false,now,'one-too-many'),/RULE_LIMIT/);
 await assert.rejects(saveShadowPlan(db,'alice',0,rule('AAPL'),false,now,'Bad Id'));
});
