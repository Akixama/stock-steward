import {getOwnership} from '../db/wallet-ownership.ts';
import {getSessionGrant} from '../db/autonomous-grants.ts';
import {getActiveModule} from '../db/active-modules.ts';
import {strategyAtBlock,latestStrategyAnchor} from './live-strategy-runtime.ts';
import {configuredLiveNews} from './live-news.ts';
import {autonomousRunId,type AutonomousDecision} from './autonomous-live.ts';
import type {Hex} from 'viem';
import {D1DecisionLedger} from '../db/ledger.ts';
import {dueShadowPlans,claimShadowPlan,finishShadowPlan,recordShadowExecution,ruleScope} from '../db/autonomous-shadow.ts';
import {evaluateAutonomousSignal,type AutonomousRule} from './autonomous-live.ts';
import {readAutonomousSignal} from './autonomous-signal.ts';
import {runTriggeredAutonomy} from './autonomous-production.ts';
import {saveAutomaticEvent,saveRuleProposal} from '../db/automatic-stage-events.ts';
import {queueAutomaticPush} from './automatic-stage-push.ts';
import {saveProposalInbox,saveAutoRenewalReminder} from '../db/notification-inbox.ts';
import {RENEW_NOTICE_SECONDS} from './permission-window.ts';
import {automaticStageIntent,automaticStages,stagesForWallet} from './automatic-stages.ts';
import {getActivation,pauseActivation} from '../db/autonomous-controls.ts';
import {loadGuard,saveGuardState} from '../db/panic-guard.ts';
import {evaluateGuard,coolingUntil} from './panic-guard.ts';
import {accountValueMicro} from './account-value.ts';
import {resolveRule} from './trailing.ts';
import {gasStatus,sessionBalanceWei,ethUsdMicro} from './session-gas.ts';
import {getFeeConsent} from '../db/autonomous-controls.ts';
// Separate from broker paper execution. A completed preview can enter the live
// adapter only through its compiled release gate and explicit owner activation.
export async function tickAutonomousShadow(db:D1Database,fetcher:typeof fetch=fetch,now=new Date(),stages:ReturnType<typeof automaticStages>=automaticStages({}),owner?:string){
 const summary={checked:0,triggered:0,blocked:0,canceled:0,failed:0,transactionsSent:0,executionEnabled:stages.autoBuy};
 const ledger=new D1DecisionLedger(db);
 for(const plan of await dueShadowPlans(db,now,owner)){
  const claim=await claimShadowPlan(db,plan,now);if(!claim)continue;
  summary.checked++;
  try{
   const rule=await resolveRule(db,JSON.parse(plan.rule_json) as AutonomousRule);
   const mandate=await ledger.getMandate(plan.owner_ref);
   let decision:AutonomousDecision;
   let buyDecision=true;
   if(rule.strategy&&mandate){
    const ownership=await getOwnership(db,plan.owner_ref);
    if(!ownership?.verifiedAt)throw Error('Verify a wallet before checking its real holdings.');
    const grant=await getSessionGrant(db,plan.owner_ref);
    const activeModule=await getActiveModule(db,plan.owner_ref,mandate.version);
    const account=activeModule?.safe as Hex|undefined??(grant?.state==='verified'?(JSON.parse(grant.policy_json) as {account:Hex}).account:ownership.address as Hex);
    const news=rule.kind==='news_buy'||rule.kind==='news_sell'?await configuredLiveNews():undefined;
    // A conservative fee allowance is for preview math only. Shadow never
    // loads signer material or submits a transaction.
    const run=await strategyAtBlock(db,plan.owner_ref,rule.strategy,mandate,account,await latestStrategyAnchor(fetcher),'500000',fetcher,fetch,news);
    buyDecision=run.decision.side==='buy';
    decision={id:autonomousRunId(ruleScope(plan.owner_ref,plan.rule_id),plan.revision,plan.next_due_at),mode:'shadow',status:run.decision.state==='ready'?'would_trigger':'blocked',symbol:run.decision.symbol,amountCents:run.decision.amountCents,createdAt:new Date().toISOString(),checks:run.decision.checks,executionEnabled:false,transactionsSent:0};
   }else{const signal=await readAutonomousSignal(rule.symbol,fetcher);decision=evaluateAutonomousSignal(ruleScope(plan.owner_ref,plan.rule_id),plan.revision,plan.next_due_at,rule,mandate,signal,new Date());}
   if(await finishShadowPlan(db,claim,decision)){
    if(decision.status==='would_trigger'){
     summary.triggered++;
     const ownership=await getOwnership(db,plan.owner_ref);
     const walletStages=stagesForWallet(stages,ownership?.verifiedAt?ownership.address:null);
     let armed=false,canSell=false;
     if(walletStages.autoBuy){const grant=await getSessionGrant(db,plan.owner_ref);armed=!!grant&&grant.state==='verified'&&(await getActivation(db,plan.owner_ref,grant.id))?.state==='armed';try{canSell=armed&&!!(JSON.parse(grant!.policy_json) as {sales?:unknown[]}).sales?.length;}catch{canSell=false;}}
     const intent=automaticStageIntent(walletStages,true,buyDecision,decision.amountCents,armed,canSell);
     if(intent==='proposal'){
      const event={id:`${decision.id}:proposal`,owner_ref:plan.owner_ref,run_id:decision.id,kind:'proposal' as const,status:'proposed' as const,symbol:decision.symbol,amount_cents:decision.amountCents,detail:'Strategy checks passed. Review a fresh exact quote in your wallet before buying.',transaction_hash:null,created_at:now.toISOString(),expires_at:new Date(now.getTime()+15*60_000).toISOString()};
      if(await saveRuleProposal(db,event,plan.revision,now,plan.rule_id)){
       await saveProposalInbox(db,event);
       await queueAutomaticPush(db,event);
      }
     }
     if(intent==='auto'||intent==='blocked'){
      // Automatic execution has independent per-order and UTC-day caps, an
      // owner-signed session grant and activation, and the global kill switch.
      if(intent==='blocked'){await recordShadowExecution(db,claim,{state:'blocked',why:'Automatic per-order cap exceeded.'});continue;}
      const grant=await getSessionGrant(db,plan.owner_ref);
      let gas:ReturnType<typeof gasStatus>|null=null;
      // Panic guard runs before any signer: a cool-off or a fresh trip stops the trade.
      if(grant){
       const guard=await loadGuard(db,plan.owner_ref,grant.id),until=coolingUntil(guard.state,now.getTime());
       if(until){await recordShadowExecution(db,claim,{state:'blocked',why:`Panic guard cool-off until ${until.slice(0,16).replace('T',' ')} UTC. No order was sent.`});continue;}
       let account:Hex|null=null;try{account=(JSON.parse(grant.policy_json) as {account:Hex}).account;}catch{account=null;}
       const value=account?await accountValueMicro(account,fetcher,fetch):null;
       if(value===null){await recordShadowExecution(db,claim,{state:'blocked',why:'Panic guard could not value your account right now, so no order was sent.'});continue;}
       const checked=evaluateGuard(guard.settings,guard.state!,value,now);await saveGuardState(db,plan.owner_ref,checked.state);
       if(!checked.tripped){
        // Gas: an empty session key cannot pay for the trade, so stop early and say so.
        const fee=await getFeeConsent(db,plan.owner_ref,grant.id);let maxFee=0;try{maxFee=fee?Number(JSON.parse(fee.consent_json).maxFeeCents):0;}catch{maxFee=0;}
        const balance=await sessionBalanceWei(grant.session_address,fetcher);
        gas=balance===null?null:gasStatus(balance,await ethUsdMicro(),maxFee||1);
        if(gas?.state==='empty'){
         const why='Your gas for automatic trades is empty, so no order was sent. Top it up on the Automatic mode card.';
         await recordShadowExecution(db,claim,{state:'blocked',why});
         const event={id:`${decision.id}:auto_action`,owner_ref:plan.owner_ref,run_id:decision.id,kind:'auto_action' as const,status:'blocked' as const,symbol:decision.symbol,amount_cents:decision.amountCents,detail:why,transaction_hash:null,created_at:now.toISOString(),expires_at:new Date(now.getTime()+24*60*60_000).toISOString()};
         if(await saveAutomaticEvent(db,event))await queueAutomaticPush(db,event);
         continue;
        }
       }
       if(checked.tripped){
        await pauseActivation(db,plan.owner_ref,grant.id);
        await recordShadowExecution(db,claim,{state:'blocked',why:checked.why!});
        const event={id:`${decision.id}:auto_action`,owner_ref:plan.owner_ref,run_id:decision.id,kind:'auto_action' as const,status:'blocked' as const,symbol:decision.symbol,amount_cents:decision.amountCents,detail:checked.why!.slice(0,500),transaction_hash:null,created_at:now.toISOString(),expires_at:new Date(now.getTime()+24*60*60_000).toISOString()};
        if(await saveAutomaticEvent(db,event))await queueAutomaticPush(db,event);
        continue;
       }
      }
      let expiry=0;
      try{expiry=Number(JSON.parse(grant?.policy_json??'{}').expiresAt);}catch{}
      if(grant&&(!Number.isSafeInteger(expiry)||expiry*1000<=now.getTime()+RENEW_NOTICE_SECONDS*1000)){
       await recordShadowExecution(db,claim,{state:'blocked',why:'Approval expires soon or could not be checked. Renew manually; no order was sent.'});
       if(Number.isSafeInteger(expiry)&&expiry>0&&await saveAutoRenewalReminder(db,plan.owner_ref,grant.id,expiry,now)){
        const event={id:`${decision.id}:auto_action`,owner_ref:plan.owner_ref,run_id:decision.id,kind:'auto_action' as const,status:'blocked' as const,symbol:decision.symbol,amount_cents:decision.amountCents,detail:'Approval expires soon. Automatic buys stopped; renew it yourself in Overview.',transaction_hash:null,created_at:now.toISOString(),expires_at:new Date(now.getTime()+24*60*60_000).toISOString()};
        if(await saveAutomaticEvent(db,event))await queueAutomaticPush(db,event);
       }
       continue;
      }
      if(await recordShadowExecution(db,claim,{state:'checking',why:'Checking autonomous release controls.'})){
       // Persist an alert before any signer can be reached. A duplicate run
       // never gets a second chance to send an unknown transaction.
       const started={id:`${decision.id}:auto_started`,owner_ref:plan.owner_ref,run_id:decision.id,kind:'auto_started' as const,status:'checking' as const,symbol:decision.symbol,amount_cents:decision.amountCents,detail:buyDecision?'Checking capped automatic buy. No outcome confirmed yet.':'Checking capped automatic sale. No outcome confirmed yet.',transaction_hash:null,created_at:new Date().toISOString(),expires_at:new Date(now.getTime()+24*60*60_000).toISOString()};
       if(!await saveAutomaticEvent(db,started))continue;
       await queueAutomaticPush(db,started);
       const execution=await runTriggeredAutonomy(db,plan.owner_ref,plan.revision,fetcher,walletStages,decision.id,plan.rule_id);
       await recordShadowExecution(db,claim,execution);
       if(execution.state==='submitted')summary.transactionsSent++;
       const event={id:`${decision.id}:auto_action`,owner_ref:plan.owner_ref,run_id:decision.id,kind:'auto_action' as const,status:execution.state==='submitted'?'submitted' as const:execution.state==='unknown'?'unknown' as const:'blocked' as const,symbol:decision.symbol,amount_cents:decision.amountCents,detail:(execution.why+(gas?.state==='low'?` Gas is running low: about ${gas.tradesLeft} trade${gas.tradesLeft===1?'':'s'} left. Top it up on the Automatic mode card.`:'')).slice(0,500),transaction_hash:execution.hash??null,created_at:new Date().toISOString(),expires_at:new Date(now.getTime()+24*60*60_000).toISOString()};
       if(await saveAutomaticEvent(db,event))await queueAutomaticPush(db,event);
      }
     }
    }else summary.blocked++;
   }else summary.canceled++;
  }catch{
   // An unavailable read is a visible held decision, never a fabricated buy.
   try{const rule=JSON.parse(plan.rule_json) as AutonomousRule;await finishShadowPlan(db,claim,{id:claim.id as Hex,mode:'shadow',status:'blocked',symbol:rule.symbol,amountCents:rule.amountCents,createdAt:new Date().toISOString(),checks:[{name:'Current evidence',passed:false,detail:'Wallet, price or account data could not be verified for this check.'}],executionEnabled:false,transactionsSent:0});}catch{await finishShadowPlan(db,claim,null).catch(()=>{});}
   summary.failed++;
  }
 }
 return summary;
}
