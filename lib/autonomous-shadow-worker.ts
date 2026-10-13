import {getFeeConsent} from '../db/autonomous-controls.ts';
import {verifyFeeConsent,type FeeConsent} from './autonomous-consent.ts';
import {getSessionGrant} from '../db/autonomous-grants.ts';
import {strategyAtBlock,latestStrategyAnchor} from './live-strategy-runtime.ts';
import {configuredLiveNews} from './live-news.ts';
import {autonomousRunId,type AutonomousDecision} from './autonomous-live.ts';
import type {Hex} from 'viem';
import {D1DecisionLedger} from '../db/ledger.ts';
import {dueShadowPlans,claimShadowPlan,finishShadowPlan,recordShadowExecution} from '../db/autonomous-shadow.ts';
import {evaluateAutonomousSignal,type AutonomousRule} from './autonomous-live.ts';
import {readAutonomousSignal} from './autonomous-signal.ts';
import {runTriggeredAutonomy} from './autonomous-production.ts';
// Separate from broker paper execution. A completed preview can enter the live
// adapter only through its compiled release gate and explicit owner activation.
export async function tickAutonomousShadow(db:D1Database,fetcher:typeof fetch=fetch,now=new Date()){
 const summary={checked:0,triggered:0,blocked:0,canceled:0,failed:0,transactionsSent:0,executionEnabled:false};
 const ledger=new D1DecisionLedger(db);
 for(const plan of await dueShadowPlans(db,now)){
  const claim=await claimShadowPlan(db,plan,now);if(!claim)continue;
  summary.checked++;
  try{
   const rule=JSON.parse(plan.rule_json) as AutonomousRule;
   const mandate=await ledger.getMandate(plan.owner_ref);
   let decision:AutonomousDecision;
   if(rule.strategy&&mandate){
    const grant=await getSessionGrant(db,plan.owner_ref);if(!grant)throw Error('Review a session wallet before checking the live strategy.');
    const policy=JSON.parse(grant.policy_json) as {account:Hex};
    const lease=JSON.parse(grant.lease_json) as {owner:string;policyHash:string};
    const record=await getFeeConsent(db,plan.owner_ref,grant.id);
    const fee=record?JSON.parse(record.consent_json) as FeeConsent:null;
    if(!fee||!record||fee.owner.toLowerCase()!==lease.owner.toLowerCase()||fee.grantId!==grant.id||fee.policyHash!==lease.policyHash||!await verifyFeeConsent(fee,record.signature))throw Error('Approve a current network fee limit before checking the strategy.');
    const news=rule.kind==='news_buy'||rule.kind==='news_sell'?await configuredLiveNews():undefined;
    const run=await strategyAtBlock(db,plan.owner_ref,rule.strategy,mandate,policy.account,await latestStrategyAnchor(fetcher),(BigInt(fee.maxFeeCents)*10000n).toString(),fetcher,fetch,news);
    decision={id:autonomousRunId(plan.owner_ref,plan.revision,plan.next_due_at),mode:'shadow',status:run.decision.state==='ready'?'would_trigger':'blocked',symbol:run.decision.symbol,amountCents:run.decision.amountCents,createdAt:new Date().toISOString(),checks:run.decision.checks,executionEnabled:false,transactionsSent:0};
   }else{const signal=await readAutonomousSignal(rule.symbol,fetcher);decision=evaluateAutonomousSignal(plan.owner_ref,plan.revision,plan.next_due_at,rule,mandate,signal,new Date());}
   if(await finishShadowPlan(db,claim,decision)){
    if(decision.status==='would_trigger'){
     summary.triggered++;
     // Persist an unfinished execution check before calling the adapter, so a
     // worker crash cannot leave a misleading "no transaction" receipt.
     if(await recordShadowExecution(db,claim,{state:'checking',why:'Checking release controls and trade evidence.'})){
      const execution=await runTriggeredAutonomy(db,plan.owner_ref,plan.revision,fetcher);
      await recordShadowExecution(db,claim,execution);
      if(execution.state==='submitted')summary.transactionsSent++;
     }
    }else summary.blocked++;
   }else summary.canceled++;
  }catch{await finishShadowPlan(db,claim,null);summary.failed++;}
 }
 return summary;
}
