import {prepareStrategyTrade} from './live-strategy-runtime.ts';
import {configuredLiveNews} from './live-news.ts';
import {getSessionGrant} from '../db/autonomous-grants.ts';
import {getShadowPlan} from '../db/autonomous-shadow.ts';
import {listSpendEvidence} from '../db/execution-attempts.ts';
import {D1DecisionLedger} from '../db/ledger.ts';
import {getOwnership} from '../db/wallet-ownership.ts';
import {inspectRoute} from './chain-route.ts';
import {selectStoredFloor} from './live-order.ts';
import {inspectRolesInstallation} from './roles-installation.ts';
import {simulateRolesOperation} from './roles-operation.ts';
import {buildAccountingEvidence} from './live-accounting.ts';
import {executionAccountingSources} from './execution-sources.ts';
import {inspectExecutionFees} from './execution-fees.ts';
import {mandateDigest,type PolicyLease} from './policy-lease.ts';
import {compileRolesPolicy,type RolesPolicy} from './roles-permission.ts';
import type {AutonomousRule} from './autonomous-live.ts';
import type {Hex} from 'viem';
import {getFeeConsent,listReleaseEvidence} from '../db/autonomous-controls.ts';
import {verifyFeeConsent,type FeeConsent} from './autonomous-consent.ts';
import {releaseProofChecks,type ReviewAuthorities} from './autonomous-release-proof.ts';
// Production read-only rehearsal. No key loader, reservation, signing or sender.
// Gaps are explicit; no external proof is replaced with a browser boolean.
export async function autonomousPreflight(db:D1Database,owner:string,rpc:typeof fetch=fetch,web:typeof fetch=fetch,authorities:ReviewAuthorities={}){
 const checks:{name:string;passed:boolean;detail:string}[]=[];const add=(name:string,passed:boolean,detail:string)=>checks.push({name,passed,detail});
 const report=()=>({executionEnabled:false,transactionsSent:0,checks,ready:false,observedAt:new Date().toISOString()});
 const grant=await getSessionGrant(db,owner),mandate=await new D1DecisionLedger(db).getMandate(owner),ownership=await getOwnership(db,owner),plan=await getShadowPlan(db,owner);
 add('Verified session grant',grant?.state==='verified'&&!!grant.creation_transaction,'A separate owner-approved session permission must be verified first.');
 add('Verified owner wallet',!!ownership?.verifiedAt,'The saved owner must still own the Steward wallet.');
 add('Saved strategy',!!plan&&!!mandate,'A saved preview rule and current mandate are required.');
 if(checks.some(check=>!check.passed)||!grant||!mandate||!ownership||!plan)return report();
 const policy=JSON.parse(grant.policy_json) as RolesPolicy,lease=JSON.parse(grant.lease_json) as PolicyLease,rule=JSON.parse(plan.rule_json) as AutonomousRule;
 const snapshot={owner:ownership.address,version:mandate.version,policyJson:JSON.stringify(mandate)};
 add('Unchanged mandate',lease.mandateDigest===mandateDigest(snapshot)&&lease.mandateVersion===mandate.version&&lease.policyHash===compileRolesPolicy(policy).policyHash,'The current mandate must match the exact session grant.');
 add('Allowed strategy',(rule.strategy?.kind==='portfolio'?rule.strategy.targets!.every(t=>mandate.allowedSymbols.includes(t.symbol)):mandate.allowedSymbols.includes(rule.symbol))&&rule.amountCents>0&&rule.amountCents<=mandate.maxOrderCents,'The rule must stay within the current allowed stocks and amount.');
 if(checks.some(check=>!check.passed))return report();
 if(rule.strategy){
  try{
   const record=await getFeeConsent(db,owner,grant.id);if(!record)throw Error('Approve a network fee limit first.');const fee=JSON.parse(record.consent_json) as FeeConsent;
   if(fee.owner!==lease.owner||fee.grantId!==grant.id||fee.policyHash!==lease.policyHash||!await verifyFeeConsent(fee,record.signature))throw Error('Current fee consent required.');
   const news=rule.kind==='news_buy'||rule.kind==='news_sell'?await configuredLiveNews():undefined;
   const trade=await prepareStrategyTrade(db,owner,rule.strategy,mandate,policy,(BigInt(fee.maxFeeCents)*10000n).toString(),rpc,web,news);
   add('Saved strategy and trade accounting',true,`A bounded ${trade.route.side??'buy'} passed the current strategy, inventory, budget and fee checks.`);
   const installed=await inspectRolesInstallation(policy,grant.creation_transaction as Hex,rpc,trade.route.block as Hex);
   add('Current onchain permission',installed.state==='verified_policy_state'&&installed.walletOwners.length===1&&installed.walletOwners[0].toLowerCase()===ownership.address.toLowerCase(),'The current owner and complete permission must match.');
   const reviewed=await releaseProofChecks(await listReleaseEvidence(db,owner,grant.id),authorities,{owner:ownership.address,account:policy.account,grantId:grant.id,policyHash:lease.policyHash});
   add('Verified account eligibility',reviewed.eligibility,'Account-specific eligibility proof required.');add('Independent security review',reviewed.security,'Exact source and policy review required.');add('Funded session rehearsal',reviewed.rehearsal,'The complete reviewed trading lifecycle must pass.');
   add('Quote still fresh',Date.parse(trade.route.expiresAt)>Date.now(),'Expired evidence must be refreshed before execution.');
  }catch(error){add('Live strategy preparation',false,error instanceof Error?error.message:'Complete strategy evidence unavailable.');}
  return report();
 }
 const amount=BigInt(policy.inputRaw),route=await inspectRoute(policy.account,rule.symbol,`${amount/1000000n}.${(amount%1000000n).toString().padStart(6,'0')}`,50,rpc);
 try{const floor=selectStoredFloor(route,policy.outputs);route.best=floor.probe;route.minimumOutputRaw=floor.floorRaw;}catch{add('Exact bounded route',false,'The installed price floor is unavailable for this route.');return report();}
 const installed=await inspectRolesInstallation(policy,grant.creation_transaction as Hex,rpc,route.block as Hex);
 add('Current onchain permission',installed.state==='verified_policy_state'&&installed.walletOwners.length===1&&installed.walletOwners[0].toLowerCase()===ownership.address.toLowerCase(),'Current runtime, owner, condition tree, membership and quotas must match.');
 const simulated=await simulateRolesOperation(route,mandate.version,policy,grant.creation_transaction as Hex,rpc);
 add('Complete account simulation',simulated.state==='simulated',simulated.why);
 const ledger=await listSpendEvidence(db,owner,policy.account);
 if(!ledger){add("Owner spend ledger",false,"Reservations and prior spend could not be read. No zero balance is assumed.");return report();}
 let quotedMaximumMicroUsd:string|null=null;
 try{
 const sources=await executionAccountingSources({number:route.block,hash:route.blockHash,timestamp:'0x'+BigInt(Math.floor(Date.parse(route.blockAt)/1000)).toString(16),observedAt:route.observedAt},rpc,web);
 const accounting=await buildAccountingEvidence(policy.account,rule.symbol,String(Math.max(1,mandate.maxOrderCents*300)),ledger,sources);
 const canonical=await sources.verifyCanonical();
 add('Block-bound dollar accounting',!!accounting.evidence&&accounting.evidence.blockHash===route.blockHash&&canonical,accounting.gaps.join(' ')||'Canonical balances, official token identities and timestamped USD bounds were checked against the route block.');
 try{const native=await sources.priceBound('ETH');if(!native)throw Error('Fresh ETH/USD quote unavailable.');const fees=await inspectExecutionFees(route,mandate.version,policy,native,rpc);quotedMaximumMicroUsd=fees.maximumMicroUsd;add('Network fee estimate',true,`Maximum estimated network cost $${(Number(fees.maximumMicroUsd)/1000000).toFixed(6)}; posting gas included once.`);add('Funded session signer',fees.sessionFunded,'The separate session wallet must cover the maximum network fee.');}
 catch{add('Network fee estimate',false,'Fresh execution and posting gas, ETH/USD valuation and session funding could not all be verified.');}
 }catch{add('Block-bound dollar accounting',false,'Fresh canonical inventory and history evidence is unavailable. Refresh and try again.');}
 const feeRecord=await getFeeConsent(db,owner,grant.id);let feeApproved=false;
 if(feeRecord){try{const consent=JSON.parse(feeRecord.consent_json) as FeeConsent;feeApproved=consent.owner===lease.owner&&consent.grantId===grant.id&&consent.policyHash===lease.policyHash&&await verifyFeeConsent(consent,feeRecord.signature);}catch{}}
 add('Owner-reviewed fee ceiling',feeApproved,'Approve your per-purchase fee limit in Release checks. The executor also compares the live fee estimate against that signed limit.');
 add('Live fee within approved ceiling',feeApproved&&quotedMaximumMicroUsd!==null&&BigInt(quotedMaximumMicroUsd)<=BigInt((JSON.parse(feeRecord!.consent_json) as FeeConsent).maxFeeCents)*10000n,'The complete current fee estimate must fit the exact signed dollar ceiling.');
 const reviewed=await releaseProofChecks(await listReleaseEvidence(db,owner,grant.id),authorities,{owner:ownership.address,account:policy.account,grantId:grant.id,policyHash:lease.policyHash});
 add('Verified account eligibility',reviewed.eligibility,'A current account-specific decision from the configured eligibility verifier is required.');
 add('Independent security review',reviewed.security,'A signed review of this exact code version and session policy is required.');
 add('Funded session rehearsal',reviewed.rehearsal,'An independently verified buy and revocation rehearsal with the separate session is required.');
 add('Quote still fresh',Date.parse(route.expiresAt)>Date.now(),'Long checks require a fresh quote before execution.');
 return report();
}
