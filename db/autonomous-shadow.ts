import {autonomousRunId,validateAutonomousRule,type AutonomousRule,type AutonomousDecision} from '../lib/autonomous-live.ts';
import {publicRunExecution,type AutonomousRunExecution} from '../lib/autonomous-run-status.ts';
export type ShadowPlan={owner_ref:string;revision:number;rule_json:string;enabled:number;next_due_at:string;lease_token:string|null;lease_until:string|null;failures:number;updated_at:string};
export type ShadowClaim={plan:ShadowPlan;id:string;token:string};
export async function getShadowPlan(db:D1Database,owner:string){return db.prepare('SELECT * FROM autonomous_shadow_plans WHERE owner_ref=?').bind(owner).first<ShadowPlan>();}
export async function saveShadowPlan(db:D1Database,owner:string,expected:number,rule:AutonomousRule,enabled:boolean,now=new Date()){
 validateAutonomousRule(rule);if(!owner||owner.length>200||!Number.isSafeInteger(expected)||expected<0||typeof enabled!=='boolean')throw Error('Invalid shadow controls.');
 const result=await db.prepare(`INSERT INTO autonomous_shadow_plans(owner_ref,revision,rule_json,enabled,next_due_at,updated_at)
 SELECT ?,1,?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM autonomous_shadow_plans WHERE owner_ref=? AND revision=?)
 ON CONFLICT(owner_ref) DO UPDATE SET revision=revision+1,rule_json=excluded.rule_json,enabled=excluded.enabled,next_due_at=excluded.next_due_at,lease_token=NULL,lease_until=NULL,failures=0,updated_at=excluded.updated_at WHERE revision=?`)
 .bind(owner,JSON.stringify(rule),enabled?1:0,now.toISOString(),now.toISOString(),expected,owner,expected,expected).run();
 return result.meta.changes===1;
}
export async function controlShadowPlan(db:D1Database,owner:string,expected:number,enabled:boolean,now=new Date()){
 if(!Number.isSafeInteger(expected)||expected<1||typeof enabled!=='boolean')throw Error('Invalid shadow controls.');
 const result=await db.prepare('UPDATE autonomous_shadow_plans SET enabled=?,revision=revision+1,next_due_at=?,lease_token=NULL,lease_until=NULL,failures=0,updated_at=? WHERE owner_ref=? AND revision=?').bind(enabled?1:0,now.toISOString(),now.toISOString(),owner,expected).run();
 return result.meta.changes===1;
}
export async function dueShadowPlans(db:D1Database,now=new Date()){
 return (await db.prepare('SELECT * FROM autonomous_shadow_plans WHERE enabled=1 AND next_due_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_due_at LIMIT 2').bind(now.toISOString(),now.toISOString()).all<ShadowPlan>()).results;
}
export async function claimShadowPlan(db:D1Database,plan:ShadowPlan,now=new Date()):Promise<ShadowClaim|null>{
 const token=crypto.randomUUID(),id=autonomousRunId(plan.owner_ref,plan.revision,plan.next_due_at),stamp=now.toISOString();
 const result=await db.batch([
  db.prepare('UPDATE autonomous_shadow_plans SET lease_token=?,lease_until=? WHERE owner_ref=? AND revision=? AND enabled=1 AND next_due_at=? AND next_due_at<=? AND (lease_until IS NULL OR lease_until<=?)').bind(token,new Date(now.getTime()+120000).toISOString(),plan.owner_ref,plan.revision,plan.next_due_at,stamp,stamp),
  db.prepare(`INSERT INTO autonomous_shadow_runs(id,owner_ref,revision,due_at,claim_token,state,created_at) SELECT ?,?,?,?,?,'running',? WHERE EXISTS(SELECT 1 FROM autonomous_shadow_plans WHERE owner_ref=? AND lease_token=?)
  ON CONFLICT(id) DO UPDATE SET claim_token=excluded.claim_token,state='running',completed_at=NULL WHERE state IN ('running','error')`).bind(id,plan.owner_ref,plan.revision,plan.next_due_at,token,stamp,plan.owner_ref,token),
 ]);
 return result[0].meta.changes===1&&result[1].meta.changes===1?{plan,id,token}:null;
}
export async function finishShadowPlan(db:D1Database,claim:ShadowClaim,decision:AutonomousDecision|null,now=new Date()){
 const p=claim.plan,rule=validateAutonomousRule(JSON.parse(p.rule_json) as AutonomousRule),stamp=now.toISOString();
 if(decision&&(decision.id!==claim.id||decision.mode!=='shadow'||decision.executionEnabled!==false||decision.transactionsSent!==0))throw Error('Mismatched shadow decision.');
 const guard='EXISTS(SELECT 1 FROM autonomous_shadow_plans WHERE owner_ref=? AND revision=? AND enabled=1 AND lease_token=? AND lease_until>?)';
 const args=[p.owner_ref,p.revision,claim.token,stamp];
 const result=await db.batch([
  db.prepare(`UPDATE autonomous_shadow_runs SET state=CASE WHEN ${guard} THEN ? ELSE 'canceled' END,decision_json=CASE WHEN ${guard} THEN ? ELSE NULL END,completed_at=? WHERE id=? AND claim_token=? AND state='running'`).bind(...args,decision?'completed':'error',...args,decision?JSON.stringify(decision):null,stamp,claim.id,claim.token),
  db.prepare(`UPDATE autonomous_shadow_plans SET lease_token=NULL,lease_until=NULL,next_due_at=?,failures=CASE WHEN ?=1 THEN 0 ELSE failures+1 END,enabled=CASE WHEN ?=0 AND failures>=2 THEN 0 ELSE enabled END,updated_at=? WHERE owner_ref=? AND revision=? AND enabled=1 AND lease_token=? AND lease_until>?`).bind(new Date(now.getTime()+rule.intervalMinutes*60000).toISOString(),decision?1:0,decision?1:0,stamp,...args),
 ]);
 return result[1].meta.changes===1;
}
export async function shadowHistory(db:D1Database,owner:string){return (await db.prepare('SELECT id,revision,due_at,state,decision_json,created_at,completed_at FROM autonomous_shadow_runs WHERE owner_ref=? ORDER BY created_at DESC LIMIT 20').bind(owner).all()).results;}

export async function recordShadowExecution(db:D1Database,claim:ShadowClaim,outcome:AutonomousRunExecution){
 const value=publicRunExecution(outcome);
 const previous=value.state==='checking'?"json_extract(decision_json,'$.execution') IS NULL":"json_extract(decision_json,'$.execution.state')='checking'";
 const result=await db.prepare(`UPDATE autonomous_shadow_runs SET decision_json=json_set(decision_json,'$.execution',json(?)) WHERE id=? AND owner_ref=? AND revision=? AND claim_token=? AND state='completed' AND json_extract(decision_json,'$.status')='would_trigger' AND ${previous}`)
 .bind(JSON.stringify(value),claim.id,claim.plan.owner_ref,claim.plan.revision,claim.token).run();
 return result.meta.changes===1;
}
