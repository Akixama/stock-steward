import {AUTONOMOUS_RELEASE_ENABLED} from './autonomous-live.ts';
import {reviewExecution} from './execution-review.ts';
import {mandateDigest,type MandateSnapshot,type PolicyLease} from './policy-lease.ts';
import {compileRolesPolicy,type RolesPolicy} from './roles-permission.ts';
import {signBoundSessionTransaction,type SessionTransactionFees} from './autonomous-session.ts';
import {beginAttempt,cancelReservation,recordSubmission,recordUnknown,reserveAttempt,type AttemptPlan} from '../db/execution-attempts.ts';
import {journalSessionTransaction,beginSessionBroadcast,finishSessionBroadcast,claimAutonomousAccount,releaseAutonomousAccount} from '../db/autonomous-transactions.ts';
import type {ExecutionEvidence} from './execution-guard.ts';
import type {AccountingEvidence,AccountingLimits} from './execution-accounting.ts';
import type {RouterCandidate} from './router-candidate.ts';
import type {Hex} from 'viem';
export type AutonomousPreparation={newsEventId?:string;evidence:ExecutionEvidence;accounting:AccountingEvidence;limits:AccountingLimits;candidate:RouterCandidate;policy:RolesPolicy;lease:PolicyLease;snapshot:MandateSnapshot;creationTx:Hex;fees:SessionTransactionFees;feeConsentDigest?:Hex};
export type AutonomousExecutionDependencies={db:D1Database;owner:string;prepare():Promise<AutonomousPreparation>;current(policyHash:string,mandateDigest:string):Promise<boolean>;loadMaterial(session:string):Promise<Hex|null>;broadcast(raw:Hex):Promise<Hex>;now():Date};
export type AutonomousOutcome={state:'blocked'|'submitted'|'unknown';why:string;hash?:Hex;intentDigest?:string;executionEnabled:boolean};
// Production cannot reach a key loader or broadcast adapter while this compiled gate is off.
export async function runAutonomousExecution(dependencies:AutonomousExecutionDependencies,releaseEnabled=AUTONOMOUS_RELEASE_ENABLED):Promise<AutonomousOutcome>{
 if(!releaseEnabled)return {state:'blocked',why:'Autonomous execution is disabled pending owner session-grant rehearsal and independent review.',executionEnabled:false};
 return executeBoundIntent(dependencies,true);
}
// Shared bounded executor for fixture tests and an explicitly owner-signed single
// purchase. Production manual adapters verify that exact approval before key access.
export async function rehearseAutonomousExecution(d:AutonomousExecutionDependencies):Promise<AutonomousOutcome>{
 return executeBoundIntent(d);
}
async function executeBoundIntent(d:AutonomousExecutionDependencies,executionEnabled=false):Promise<AutonomousOutcome>{
 const blocked=(why:string):AutonomousOutcome=>({state:'blocked',why,executionEnabled});
 let intent:string|undefined,signedHash:Hex|undefined,claimed=false,accountClaimed=false;
 try{
  const p=await d.prepare(),now=d.now(),compiled=compileRolesPolicy(p.policy);
  if(!['automatic','approval'].includes(p.evidence.approval.mode)||p.lease.state!=='active'||p.lease.policyHash!==compiled.policyHash||p.lease.mandateDigest!==mandateDigest(p.snapshot)||p.lease.mandateVersion!==p.evidence.mandateVersion)return blocked('Saved strategy, grant or mandate changed.');
  const review=reviewExecution(p.evidence,p.accounting,p.limits,p.candidate,now.getTime());
  if(!review.checksPassed)return blocked(review.reasons.join(' '));
  if(!await d.current(compiled.policyHash,p.lease.mandateDigest))return blocked('Execution paused or permission revoked.');
  const cents=Number(review.accounting.proposedCents);
  const plan:AttemptPlan={...(p.newsEventId?{newsEventId:p.newsEventId}:{}),publicMode:executionEnabled,owner:d.owner,address:p.evidence.route.address,intentDigest:p.evidence.intentDigest,mandateVersion:p.evidence.mandateVersion,day:now.toISOString().slice(0,10),amountCents:cents,dailyCapCents:p.limits.maxDailyCents,candidate:p.candidate,route:p.evidence.route,permission:{policy:p.policy,creationTx:p.creationTx}};
  intent=plan.intentDigest;
  accountClaimed=await claimAutonomousAccount(d.db,d.owner,plan.address,intent,now);
  if(!accountClaimed)return blocked('Another unresolved order holds this account.');
  if(!await reserveAttempt(d.db,plan,now))return blocked('Duplicate intent or insufficient daily budget.');
  const material=await d.loadMaterial(p.policy.session);
  if(!material||!await d.current(compiled.policyHash,p.lease.mandateDigest)){await cancelReservation(d.db,d.owner,intent,d.now());return blocked('Session key unavailable, paused or permission revoked.');}
  const signed=await signBoundSessionTransaction(material,p.evidence.route,p.evidence.mandateVersion,p.policy,p.lease,p.snapshot,p.fees,d.now().getTime());
  const hash=await journalSessionTransaction(d.db,d.owner,intent,signed.session,signed.nonce,signed.raw,d.now());
  if(!hash){await cancelReservation(d.db,d.owner,intent,d.now());return blocked('Session nonce already belongs to another intent.');}
  signedHash=hash;
  if(!await d.current(compiled.policyHash,p.lease.mandateDigest)||Date.parse(p.evidence.route.expiresAt)<=d.now().getTime()){await cancelReservation(d.db,d.owner,intent,d.now());return blocked('Controls or quote changed before broadcast.');}
  if(!await beginAttempt(d.db,d.owner,intent,p.evidence.mandateVersion,d.now())){await cancelReservation(d.db,d.owner,intent,d.now());return blocked('Attempt was already claimed or the UTC day changed.');}
  claimed=true;
  // Record exact signed hash before broadcast; response loss can then be reconciled.
  if(!await recordSubmission(d.db,d.owner,intent,hash,d.now())||!await beginSessionBroadcast(d.db,d.owner,intent,d.now()))throw Error('Broadcast claim unavailable.');
  const received=await d.broadcast(signed.raw);
  if(received.toLowerCase()!==hash.toLowerCase())throw Error('Unexpected broadcast identity.');
  await finishSessionBroadcast(d.db,d.owner,intent,true,d.now());
  return {state:'submitted',why:'Transaction submitted once; trade receipt verification is separate.',hash,intentDigest:intent,executionEnabled};
 }catch{
  if(intent&&claimed){await recordUnknown(d.db,d.owner,intent,d.now());await finishSessionBroadcast(d.db,d.owner,intent,false,d.now());return {state:'unknown',why:'Submission outcome uncertain. Exact hash and budget remain reserved; do not retry.',hash:signedHash,intentDigest:intent,executionEnabled};}
  if(intent)await cancelReservation(d.db,d.owner,intent,d.now());
  return blocked('Complete fresh execution evidence or session signing is unavailable.');
 }finally{
  if(intent&&accountClaimed&&!claimed)await releaseAutonomousAccount(d.db,d.owner,intent);
 }
}
