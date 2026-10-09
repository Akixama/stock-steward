import {beginAttempt,recordSubmission,recordUnknown,reserveAttempt,type AttemptPlan} from '../db/execution-attempts.ts';
import {reviewExecution} from './execution-review.ts';
import type {ExecutionEvidence} from './execution-guard.ts';
import type {AccountingEvidence,AccountingLimits} from './execution-accounting.ts';
import type {RouterCandidate} from './router-candidate.ts';
import {mandateDigest,type MandateSnapshot,type PolicyLease} from './policy-lease.ts';

// One-attempt submission adapter. Dormant: no route, worker or installer calls this module.
// It is the enforcement wrapper a future owner-approved execution path must pass through.
// Every gate runs before any signing; the ledger reserves each intent exactly once; an
// uncertain signer outcome becomes durable 'unknown' and is NEVER retried. Autonomous
// execution stays disabled: an exact owner approval is required per attempt. Signer material
// loading is injected (production wires db/session-signers decryption; tests use doubles).
export type Signer = (material:string,candidate:RouterCandidate)=>Promise<string>;
export type SubmissionRequest={
  submissionSwitchOn:boolean;paused:boolean;
  owner:string;mandateSnapshot:MandateSnapshot|null;
  evidence:ExecutionEvidence;accounting:AccountingEvidence;limits:AccountingLimits;
  candidate:RouterCandidate;lease:PolicyLease;existingLeases:PolicyLease[];
  db:D1Database;signer:Signer;
  loadMaterial(owner:string,address:string):Promise<string|null>;
  now?:Date;
};
export type SubmissionOutcome=
  |{outcome:'blocked';reasons:string[];attempted:false;executionEnabled:false;autonomousExecution:false}
  |{outcome:'submitted';transactionHash:string;intentDigest:string;attempted:true;executionEnabled:false;autonomousExecution:false}
  |{outcome:'unknown';intentDigest:string;attempted:true;executionEnabled:false;autonomousExecution:false;why:string};

export async function submitOnce(request:SubmissionRequest):Promise<SubmissionOutcome>{
 const now=request.now??new Date();
 const blocked=(reasons:string[]):SubmissionOutcome=>({outcome:'blocked',reasons,attempted:false,executionEnabled:false,autonomousExecution:false});
 const unknown=(intentDigest:string,why:string):SubmissionOutcome=>({outcome:'unknown',intentDigest,attempted:true,executionEnabled:false,autonomousExecution:false,why});

 // Gate 1: the deployment switch and pause fence. Nothing proceeds past either.
 if(!request.submissionSwitchOn)return blocked(['Submission switch is off. No signing was attempted.']);
 if(request.paused)return blocked(['Execution is paused. No signing was attempted.']);

 // Gate 2: the grant lease must be active, bound to this session signer and still match
 // the saved mandate. Revoked, drifted or stale leases block before any spend.
 if(request.lease.state!=='active')return blocked(['The spending grant is revoked or inactive.']);
 let digest:string|null=null;try{digest=request.mandateSnapshot?mandateDigest(request.mandateSnapshot):null;}catch{digest=null;}
 if(!digest||digest.toLowerCase()!==request.lease.mandateDigest.toLowerCase()||request.mandateSnapshot!.version!==request.lease.mandateVersion)
  return blocked(['The saved mandate changed since this grant was bound. Revoke and rebind first.']);
 for(const other of request.existingLeases)
  if(other.owner===request.lease.owner&&other.account===request.lease.account&&other.state==='active'&&other.grantId!==request.lease.grantId)
   return blocked(['A second active grant would add budgets. Revoke the earlier grant first.']);

 // Gate 3: an exact owner approval is required for every attempt; automatic mode never submits.
 if(request.evidence.approval.mode!=='approval'||!request.evidence.approval.intentDigest)
  return blocked(['An exact owner approval of this intent is required. Automatic mode never submits.']);
 // Gate 4: the internal review binds guard + dollar accounting + the exact candidate.
 const review=reviewExecution(request.evidence,request.accounting,request.limits,request.candidate,now.getTime());
 if(!review.checksPassed)return blocked(review.reasons);

 // Gate 5: the encrypted signer material must load for the lease session.
 const material=await request.loadMaterial(request.owner,request.lease.session);
 if(material===null)return blocked(['Session signer material is unavailable for this grant.']);

 // One-attempt enforcement: the ledger reserves the intent atomically. A second call for the
 // same intent, or spend beyond the daily cap, is refused here and can never reach a signer.
 const proposedCents=review.accounting.proposedCents;
 if(proposedCents===null)return blocked(['Dollar accounting produced no proposed amount.']);
 const plan:AttemptPlan={owner:request.owner,address:request.evidence.route.address,intentDigest:request.evidence.intentDigest,
  mandateVersion:request.evidence.mandateVersion,day:now.toISOString().slice(0,10),amountCents:Number(proposedCents),
  dailyCapCents:request.limits.maxDailyCents,candidate:request.candidate,route:request.evidence.route};
 let reserved=false;
 try{reserved=await reserveAttempt(request.db,plan,now);}catch{/* Invalid plans block; they never reach a signer. */}
 if(!reserved)return blocked(['This intent was already attempted or the daily budget is spent. One attempt only.']);
 if(!await beginAttempt(request.db,request.owner,request.evidence.intentDigest,request.evidence.mandateVersion,now)){
  await recordUnknown(request.db,request.owner,request.evidence.intentDigest,now);
  return unknown(request.evidence.intentDigest,'The attempt could not be claimed once. Recorded unknown; it will never be retried.');
 }

 // Signing: any signer exception is treated as uncertain (the request may have left the
 // process), recorded unknown and never retried. Only a well-formed hash is a submission.
 try{
  const transactionHash=await request.signer(material,request.candidate);
  if(!/^0x[0-9a-f]{64}$/.test(transactionHash)){await recordUnknown(request.db,request.owner,request.evidence.intentDigest,now);return unknown(request.evidence.intentDigest,'The signer returned no usable transaction hash. Recorded unknown; it will never be retried.');}
  if(!await recordSubmission(request.db,request.owner,request.evidence.intentDigest,transactionHash,now)){
   await recordUnknown(request.db,request.owner,request.evidence.intentDigest,now);
   return unknown(request.evidence.intentDigest,'The recorded hash conflicted with existing evidence. Recorded unknown; it will never be retried.');
  }
  return {outcome:'submitted',transactionHash:transactionHash.toLowerCase(),intentDigest:request.evidence.intentDigest,attempted:true,executionEnabled:false,autonomousExecution:false};
 }catch{
  await recordUnknown(request.db,request.owner,request.evidence.intentDigest,now);
  return unknown(request.evidence.intentDigest,'The signer outcome is uncertain. Recorded unknown; it will never be retried. A trusted chain reconciliation must settle it.');
 }
}
