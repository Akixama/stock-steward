import {reconcileDirectFill,reconcileOwnerOrderFill,reconcileRolesFill} from './chain-fill-proof.ts';
import {validateRouterCandidate,routerCandidate} from './router-candidate.ts';
import {recoverInterruptedAttempt,settleAttempt,type Attempt,type AttemptPlan} from '../db/execution-attempts.ts';
import {withRoleMembership} from './role-membership.ts';
import {rolesOperation} from './roles-operation.ts';
import {verifyPolicyReadback} from './live-order.ts';
import {compileRolesPolicy} from './roles-permission.ts';
import {CHAIN} from './robinhood-chain.ts';
import type {Hex} from 'viem';

async function ownerProof(plan:AttemptPlan,attempt:Attempt,fetcher:typeof fetch){
  const policy=plan.livePolicy!;
  const compiled=compileRolesPolicy(policy),operation=rolesOperation(plan.route!,attempt.mandate_version,policy);
  const read=async(to:string,data:Hex,block:string):Promise<Hex>=>{
    const response=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to,data},block]}),cache:'no-store',signal:AbortSignal.timeout(12000)});
    const body=await response.json() as {result?:string;error?:unknown};
    if(!response.ok||body.error||typeof body.result!=='string'||!/^0x[0-9a-f]*$/i.test(body.result))throw Error('Historical owner permission unavailable');
    return body.result as Hex;
  };
  const verify=async(block:Hex)=>{
    const readback=await verifyPolicyReadback(policy,compiled,withRoleMembership(read,fetcher),block);
    return readback.allOk;
  };
  return reconcileOwnerOrderFill(plan.route!,attempt.mandate_version,attempt.transaction_hash!,policy.routerCodeHash,
    {from:operation.from,to:operation.to,data:operation.data,value:operation.value,verify},fetcher);
}
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
 const proof=plan.livePolicy?await ownerProof(plan,row,fetcher):plan.permission?await reconcileRolesFill(plan.route,plan.mandateVersion,row.transaction_hash,plan.permission.policy,plan.permission.creationTx,fetcher):await reconcileDirectFill(plan.route,plan.mandateVersion,row.transaction_hash,plan.routerCodeHash,fetcher);
 if(await settleAttempt(db,row.owner_ref,row.id,proof,now))summary.settled++;else summary.unresolved++;
 }catch{summary.unresolved++;}
 finally{
 // Advance only the inspection time, so one unsupported plan cannot starve later records.
 await db.prepare("UPDATE execution_attempts SET updated_at=? WHERE owner_ref=? AND id=? AND state IN ('submitted','unknown') AND updated_at=?").bind(now.toISOString(),row.owner_ref,row.id,row.updated_at).run();
 }
 }
 return summary;
}
