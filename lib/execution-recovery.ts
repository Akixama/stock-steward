import {reconcileDirectFill,reconcileRolesFill} from './chain-fill-proof.ts';
import {validateRouterCandidate,routerCandidate} from './router-candidate.ts';
import {recoverInterruptedAttempt,settleAttempt,type Attempt,type AttemptPlan} from '../db/execution-attempts.ts';
// Scheduled recovery has no signer or submission adapter. Never resend an unknown attempt.
export async function recoverExecutionAttempts(db:D1Database,fetcher:typeof fetch=fetch,now=new Date()){
 const cutoff=new Date(now.getTime()-10*60000).toISOString();
 const rows=await db.prepare("SELECT * FROM execution_attempts WHERE state IN ('attempting','submitted','unknown') AND updated_at<=? ORDER BY updated_at,id LIMIT 3").bind(cutoff).all<Attempt>();
 const summary={checked:0,recovered:0,settled:0,unresolved:0,transactionsSent:0};
 for(const row of rows.results){summary.checked++;
 try{
 if(row.state==='attempting'){if(await recoverInterruptedAttempt(db,row.owner_ref,row.id,now))summary.recovered++;summary.unresolved++;continue;}
 if(!row.transaction_hash)throw Error('No submission identity');
 const plan=JSON.parse(row.plan_json) as AttemptPlan;
 if(plan.owner!==row.owner_ref||plan.address!==row.address||plan.intentDigest!==row.id||plan.mandateVersion!==row.mandate_version||!plan.route||!plan.routerCodeHash||plan.route.address!==row.address||!validateRouterCandidate(plan.route,plan.mandateVersion,plan.candidate)||routerCandidate(plan.route,plan.mandateVersion).intentDigest!==row.id)throw Error('Incomplete bound plan');
 const proof=plan.permission?await reconcileRolesFill(plan.route,plan.mandateVersion,row.transaction_hash,plan.permission.policy,plan.permission.creationTx,fetcher):await reconcileDirectFill(plan.route,plan.mandateVersion,row.transaction_hash,plan.routerCodeHash,fetcher);
 if(await settleAttempt(db,row.owner_ref,row.id,proof,now))summary.settled++;else summary.unresolved++;
 }catch{summary.unresolved++;}
 finally{
 // Advance only the inspection time, so one unsupported plan cannot starve later records.
 await db.prepare("UPDATE execution_attempts SET updated_at=? WHERE owner_ref=? AND id=? AND state IN ('submitted','unknown') AND updated_at=?").bind(now.toISOString(),row.owner_ref,row.id,row.updated_at).run();
 }
 }
 return summary;
}
