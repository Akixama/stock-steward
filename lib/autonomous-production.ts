import {prepareStrategyTrade} from './live-strategy-runtime.ts';
import {configuredLiveNews} from './live-news.ts';
import {getSessionGrant} from '../db/autonomous-grants.ts';import {getShadowPlan} from '../db/autonomous-shadow.ts';import {getOwnership} from '../db/wallet-ownership.ts';import {D1DecisionLedger} from '../db/ledger.ts';import {listSpendEvidence} from '../db/execution-attempts.ts';import {getFeeConsent,listReleaseEvidence} from '../db/autonomous-controls.ts';import {loadSessionSignerMaterial} from '../db/session-signers.ts';
import {verifyFeeConsent,type FeeConsent} from './autonomous-consent.ts';import {releaseProofChecks,type ReviewAuthorities} from './autonomous-release-proof.ts';
import {AUTONOMOUS_RELEASE_ENABLED} from './autonomous-live.ts';import {runAutonomousExecution} from './autonomous-executor.ts';
import {getActivation} from '../db/autonomous-controls.ts';import {verifyActivation,controlDigest,type ActivationConsent} from './autonomous-activation.ts';
import {verifyManualSessionApproval} from './manual-session-approval.ts';
export type ProductionMode={mode:'manual_prepare'}|{mode:'manual_execute';preparation:AutonomousPreparation;origin:string;signature:Hex};
import {inspectRoute} from './chain-route.ts';import {selectStoredFloor} from './live-order.ts';import {rolesOperation} from './roles-operation.ts';import {inspectRolesInstallation} from './roles-installation.ts';import {routerCandidate} from './router-candidate.ts';import {compileRolesPolicy,type RolesPolicy} from './roles-permission.ts';import {mandateDigest,type PolicyLease} from './policy-lease.ts';import {executionAccountingSources} from './execution-sources.ts';import {buildAccountingEvidence} from './live-accounting.ts';import {executionAccounting} from './execution-accounting.ts';import {inspectExecutionFees} from './execution-fees.ts';import {readAutonomousSignal} from './autonomous-signal.ts';import {evaluateAutonomousSignal,type AutonomousRule} from './autonomous-live.ts';import type {AutonomousExecutionDependencies,AutonomousPreparation} from './autonomous-executor.ts';import {CHAIN} from './robinhood-chain.ts';import type {Hex} from 'viem';
// The production adapter is callable only through the compiled execution gate.
// Preparing is read-only; it never invents eligibility, reviewer or owner consent.
export function productionExecutionDependencies(db:D1Database,owner:string,revision:number,authorities:ReviewAuthorities,rpc:typeof fetch=fetch,web:typeof fetch=fetch,manual?:ProductionMode):AutonomousExecutionDependencies{
 let prepared:AutonomousPreparation|null=null,approvedConsent:string|null=null;
 async function current(policyHash:string,digest:string){
  const [grant,plan,ownership,mandate]=await Promise.all([getSessionGrant(db,owner),getShadowPlan(db,owner),getOwnership(db,owner),new D1DecisionLedger(db).getMandate(owner)]);
  if(!grant||grant.state!=='verified'||!plan?.enabled||plan.revision!==revision||!ownership?.verifiedAt||!mandate||mandate.executionPreference!=='automatic')return false;
  const lease=JSON.parse(grant.lease_json) as PolicyLease,policy=JSON.parse(grant.policy_json) as RolesPolicy,snapshot={owner:ownership.address,version:mandate.version,policyJson:JSON.stringify(mandate)};
  if(lease.state!=='active'||lease.policyHash!==policyHash||lease.mandateDigest!==digest||mandateDigest(snapshot)!==digest||compileRolesPolicy(policy).policyHash!==policyHash||policy.expiresAt*1000<=Date.now())return false;
  const consent=await getFeeConsent(db,owner,grant.id);if(!consent)return false;const fee=JSON.parse(consent.consent_json) as FeeConsent;
  if(fee.grantId!==grant.id||fee.policyHash!==policyHash||fee.owner!==lease.owner||!await verifyFeeConsent(fee,consent.signature))return false;
  if(approvedConsent&&consent.consent_json!==approvedConsent)return false;
  if(prepared?.feeConsentDigest&&prepared.feeConsentDigest!==controlDigest(fee))return false;
  const armed=await getActivation(db,owner,grant.id);if(armed?.state==='paused')return false;
  if(!manual){if(!armed||armed.state!=='armed')return false;
  const activation=JSON.parse(armed.consent_json) as ActivationConsent;
  if(activation.owner!==lease.owner||activation.grantId!==grant.id||activation.policyHash!==policyHash||activation.mandateDigest!==digest||activation.planRevision!==revision||activation.ruleDigest!==controlDigest(JSON.parse(plan.rule_json))||activation.feeDigest!==controlDigest(fee)||!await verifyActivation(activation,armed.signature))return false;}
  const reviews=await releaseProofChecks(await listReleaseEvidence(db,owner,grant.id),authorities,{owner:ownership.address,account:policy.account,grantId:grant.id,policyHash});if(!reviews.security||!reviews.eligibility||(!manual&&!reviews.rehearsal))return false;
  if(prepared){const installed=await inspectRolesInstallation(policy,grant.creation_transaction as Hex,rpc);if(installed.state!=='verified_policy_state'||installed.walletOwners.length!==1||installed.walletOwners[0].toLowerCase()!==ownership.address.toLowerCase()||BigInt(installed.dailyRemainingCalls??'0')<1n||BigInt(installed.totalRemainingCalls??'0')<1n)return false;}
  return true;
 }
 return {db,owner,current,now:()=>new Date(),prepare:async()=>{
  if(manual?.mode==='manual_execute'){
   if(!await verifyManualSessionApproval(manual.preparation,manual.origin,manual.signature))throw Error('Exact owner rehearsal approval required.');
   prepared=manual.preparation;prepared.evidence.approval={mode:'approval',intentDigest:prepared.evidence.intentDigest,routeId:prepared.evidence.route.id,mandateVersion:prepared.evidence.mandateVersion,expiresAt:prepared.evidence.route.expiresAt};
   if(!await current(prepared.lease.policyHash,prepared.lease.mandateDigest))throw Error('Reviewed permission or controls changed.');return prepared;
  }
  const [grant,plan,ownership,mandate]=await Promise.all([getSessionGrant(db,owner),getShadowPlan(db,owner),getOwnership(db,owner),new D1DecisionLedger(db).getMandate(owner)]);
  if(!grant||grant.state!=='verified'||!grant.creation_transaction||!plan?.enabled||plan.revision!==revision||!ownership?.verifiedAt||!mandate||mandate.executionPreference!=='automatic')throw Error('Current automatic mandate and verified grant required.');
  const policy=JSON.parse(grant.policy_json) as RolesPolicy,lease=JSON.parse(grant.lease_json) as PolicyLease,rule=JSON.parse(plan.rule_json) as AutonomousRule,snapshot={owner:ownership.address,version:mandate.version,policyJson:JSON.stringify(mandate)};
  if(rule.strategy){
   if(!await current(compileRolesPolicy(policy).policyHash,mandateDigest(snapshot)))throw Error('Release evidence or strategy controls changed.');
   const consent=await getFeeConsent(db,owner,grant.id);if(!consent)throw Error('Fee approval missing.');const fee=JSON.parse(consent.consent_json) as FeeConsent;
   if(!await verifyFeeConsent(fee,consent.signature)||fee.policyHash!==lease.policyHash||fee.grantId!==grant.id||fee.owner!==lease.owner)throw Error('Fee consent changed.');
   const news=rule.kind==='news_buy'||rule.kind==='news_sell'?await configuredLiveNews():undefined;
   const trade=await prepareStrategyTrade(db,owner,rule.strategy,mandate,policy,(BigInt(fee.maxFeeCents)*10000n).toString(),rpc,web,news);
   const {route,quoted}=trade;
   const installed=await inspectRolesInstallation(policy,grant.creation_transaction as Hex,rpc,route.block as Hex);
   if(installed.state!=='verified_policy_state'||installed.walletOwners.length!==1||installed.walletOwners[0].toLowerCase()!==ownership.address.toLowerCase())throw Error('Current owner and permission unverified.');
   const candidate=routerCandidate(route,mandate.version);approvedConsent=consent.consent_json;
  prepared={newsEventId:trade.newsEventId,candidate,policy,lease,snapshot,feeConsentDigest:controlDigest(fee),creationTx:grant.creation_transaction as Hex,limits:trade.limits,accounting:trade.accounting,fees:{nonce:quoted.nonce,gas:BigInt(quoted.gas),maxFeePerGas:BigInt(quoted.maxFeePerGas),maxPriorityFeePerGas:BigInt(quoted.maxPriorityFeePerGas),maximumGasCostWei:BigInt(quoted.maximumGasCostWei)},evidence:{route,intentDigest:candidate.intentDigest,owner:policy.account,mandateVersion:mandate.version,observedMandateVersion:mandate.version,paused:false,ownershipVerified:true,eligibilityVerified:true,permission:{installed:true,expiresAt:new Date(policy.expiresAt*1000).toISOString(),revoked:false,tokenCaps:true,recipients:true,outputTokens:true,calldata:true,revocationTested:true,implementationVerified:true},fundsVerified:true,dailyReserved:true,concentrationVerified:true,simulation:{success:true,account:policy.account,routeId:route.id,blockHash:route.blockHash,intentDigest:candidate.intentDigest},fees:{complete:true,withinCap:true},approval:{mode:'automatic',intentDigest:null,routeId:null,mandateVersion:null,expiresAt:null}}};return prepared;
  }
  const signal=await readAutonomousSignal(rule.symbol,web);if(evaluateAutonomousSignal(owner,revision,plan.next_due_at,rule,mandate,signal).status!=='would_trigger')throw Error('Strategy does not currently trigger.');
  if(!await current(compileRolesPolicy(policy).policyHash,mandateDigest(snapshot)))throw Error('Release evidence or grant changed.');
  const amount=BigInt(policy.inputRaw),route=await inspectRoute(policy.account,rule.symbol,`${amount/1000000n}.${(amount%1000000n).toString().padStart(6,'0')}`,50,rpc);
  const floor=selectStoredFloor(route,policy.outputs);route.best=floor.probe;route.minimumOutputRaw=floor.floorRaw;rolesOperation(route,mandate.version,policy);
  const sources=await executionAccountingSources({number:route.block,hash:route.blockHash,timestamp:'0x'+BigInt(Math.floor(Date.parse(route.blockAt)/1000)).toString(16),observedAt:route.observedAt},rpc,web);
  const native=await sources.priceBound('ETH');if(!native)throw Error('Fresh ETH/USD price unavailable.');const quoted=await inspectExecutionFees(route,mandate.version,policy,native,rpc);
  const consent=await getFeeConsent(db,owner,grant.id);if(!consent)throw Error('Fee approval missing.');const fee=JSON.parse(consent.consent_json) as FeeConsent;
  if(!await verifyFeeConsent(fee,consent.signature)||fee.policyHash!==lease.policyHash||fee.grantId!==grant.id||fee.owner!==lease.owner||BigInt(quoted.maximumMicroUsd)>BigInt(fee.maxFeeCents)*10000n||!quoted.sessionFunded)throw Error('Approved network fee ceiling or session funds unavailable.');
  const spend=await listSpendEvidence(db,owner,policy.account);if(!spend)throw Error('Spend ledger unavailable.');
  const loss=BigInt(quoted.maximumMicroUsd)+(BigInt(rule.amountCents)*10000n*BigInt(route.slippageBps)+9999n)/10000n+1n;
  const assembly=await buildAccountingEvidence(policy.account,rule.symbol,loss.toString(),spend,sources);if(!assembly.evidence||!await sources.verifyCanonical())throw Error('Incomplete canonical accounting.');
  const targetPrice=await sources.priceBound(rule.symbol);if(!targetPrice||!route.best?.outputRaw)throw Error('Target exposure bound unavailable.');
  const decimals=await sources.tokenDecimals(route.token);if(decimals===null)throw Error('Target token decimals unavailable.');const scale=10n**BigInt(decimals);
  assembly.evidence.portfolio.proposedPositionMicroUsd=((BigInt(route.best.outputRaw)*BigInt(targetPrice.upperMicroUsd)+scale-1n)/scale).toString();
  const limits={maxOrderCents:Math.min(rule.amountCents,mandate.maxOrderCents),maxDailyCents:mandate.maxDailyBuyCents,maxPositionBps:mandate.maxPositionBps};
  const money=executionAccounting(assembly.evidence,policy.inputRaw,limits);if(!money.checksPassed)throw Error('Dollar budget or concentration did not pass.');
  const installed=await inspectRolesInstallation(policy,grant.creation_transaction as Hex,rpc,route.block as Hex);if(installed.state!=='verified_policy_state'||installed.walletOwners.length!==1||installed.walletOwners[0].toLowerCase()!==ownership.address.toLowerCase())throw Error('Current owner and permission unverified.');
  const candidate=routerCandidate(route,mandate.version);approvedConsent=consent.consent_json;
  prepared={candidate,policy,lease,snapshot,feeConsentDigest:controlDigest(fee),creationTx:grant.creation_transaction as Hex,limits,accounting:assembly.evidence,fees:{nonce:quoted.nonce,gas:BigInt(quoted.gas),maxFeePerGas:BigInt(quoted.maxFeePerGas),maxPriorityFeePerGas:BigInt(quoted.maxPriorityFeePerGas),maximumGasCostWei:BigInt(quoted.maximumGasCostWei)},evidence:{route,intentDigest:candidate.intentDigest,owner:policy.account,mandateVersion:mandate.version,observedMandateVersion:mandate.version,paused:false,ownershipVerified:true,eligibilityVerified:true,permission:{installed:true,expiresAt:new Date(policy.expiresAt*1000).toISOString(),revoked:false,tokenCaps:true,recipients:true,outputTokens:true,calldata:true,revocationTested:true,implementationVerified:true},fundsVerified:true,dailyReserved:true,concentrationVerified:true,simulation:{success:true,account:policy.account,routeId:route.id,blockHash:route.blockHash,intentDigest:candidate.intentDigest},fees:{complete:true,withinCap:true},approval:{mode:'automatic',intentDigest:null,routeId:null,mandateVersion:null,expiresAt:null}}};return prepared;
 },loadMaterial:async(session)=>{const allowed=manual?.mode==='manual_execute'?await verifyManualSessionApproval(manual.preparation,manual.origin,manual.signature):!manual&&AUTONOMOUS_RELEASE_ENABLED;if(!allowed||!prepared||session.toLowerCase()!==prepared.policy.session.toLowerCase()||!await current(prepared.lease.policyHash,prepared.lease.mandateDigest))return null;return await loadSessionSignerMaterial(db,owner,session) as Hex|null;},broadcast:async(raw)=>{
  const allowed=manual?.mode==='manual_execute'?await verifyManualSessionApproval(manual.preparation,manual.origin,manual.signature):!manual&&AUTONOMOUS_RELEASE_ENABLED;
  if(!allowed||!prepared||!await current(prepared.lease.policyHash,prepared.lease.mandateDigest)||Date.parse(prepared.evidence.route.expiresAt)<=Date.now())throw Error('Controls changed before network submission.');
  const r=await rpc(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_sendRawTransaction',params:[raw]}),signal:AbortSignal.timeout(15000),cache:'no-store'});const body=await r.json() as {id:number;result:Hex;error?:unknown};if(!r.ok||body.id!==1||body.error||!/^0x[0-9a-f]{64}$/i.test(body.result))throw Error('Submission response uncertain.');return body.result;
 }};
}
export async function runTriggeredAutonomy(db:D1Database,owner:string,revision:number,rpc:typeof fetch=fetch){
 if(!AUTONOMOUS_RELEASE_ENABLED)return {state:'blocked' as const,why:'Release review and wallet rehearsal are pending.',executionEnabled:false as const};
 const {env}=await import('cloudflare:workers');let authorities:ReviewAuthorities={};try{authorities=JSON.parse(env.STEWARD_AUTONOMY_REVIEW_AUTHORITIES??'{}');}catch{}
 return runAutonomousExecution(productionExecutionDependencies(db,owner,revision,authorities,rpc,fetch));
}
