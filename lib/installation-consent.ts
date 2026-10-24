// One-signature setup. The owner's wallet transaction that installs the session
// permission is the consent: the fee ceiling and length were chosen on the same
// screen right before signing, and the transaction is verified onchain (exact
// calldata, sender, success, factory provenance) before anything is armed.
// Older two-message approvals still verify through their signatures.
import type {Hex} from 'viem';
import {verifyFeeConsent,type FeeConsent} from './autonomous-consent.ts';
import {verifyActivation,controlDigest,type ActivationConsent} from './autonomous-activation.ts';
import {AUTONOMOUS_SOURCE_DIGEST} from './autonomous-release-manifest.ts';

export const INSTALLED_FEE='stock-steward-fee-consent-installation-v1';
export const INSTALLED_START='stock-steward-activation-installation-v1';
type Grant={id:string;state:string;grant_transaction:string|null;lease_json:string;policy_json:string};
export type InstalledFee=Omit<FeeConsent,'schema'>&{schema:typeof INSTALLED_FEE};
export type InstalledStart=Omit<ActivationConsent,'schema'|'ruleDigest'|'planRevision'>&{schema:typeof INSTALLED_START;ruleDigest:null;planRevision:null};

function installed(grant:Grant,signature:string){
 return grant.state==='verified'&&!!grant.grant_transaction&&/^0x[0-9a-f]{64}$/i.test(signature)&&signature.toLowerCase()===grant.grant_transaction.toLowerCase();
}

export function installationConsents(grant:Grant,origin:string,maxFeeCents:number,mandateDigest:string,now=new Date()){
 if(grant.state!=='verified'||!grant.grant_transaction)throw Error('Verified installation required.');
 if(!Number.isSafeInteger(maxFeeCents)||maxFeeCents<1||maxFeeCents>1000)throw Error('Fee limit must be $0.01 to $10.');
 const lease=JSON.parse(grant.lease_json) as {owner:string;policyHash:string};const policy=JSON.parse(grant.policy_json) as {expiresAt:number};
 const expiresAt=new Date(policy.expiresAt*1000).toISOString(),issuedAt=now.toISOString();
 const fee:InstalledFee={schema:INSTALLED_FEE,origin,owner:lease.owner,grantId:grant.id,policyHash:lease.policyHash,maxFeeCents,issuedAt,expiresAt};
 const start:InstalledStart={schema:INSTALLED_START,origin,owner:lease.owner,grantId:grant.id,policyHash:lease.policyHash,mandateDigest,ruleDigest:null,planRevision:null,feeDigest:controlDigest(fee),sourceDigest:AUTONOMOUS_SOURCE_DIGEST,issuedAt,expiresAt};
 return {fee,start,signature:grant.grant_transaction as Hex};
}

export async function verifyFeeRecord(consent:FeeConsent|InstalledFee,signature:Hex,grant:Grant,now=Date.now()){
 if(consent.schema===INSTALLED_FEE){
  const lease=JSON.parse(grant.lease_json) as {owner:string;policyHash:string};
  return installed(grant,signature)&&consent.grantId===grant.id&&consent.owner===lease.owner&&consent.policyHash===lease.policyHash&&Number.isSafeInteger(consent.maxFeeCents)&&consent.maxFeeCents>=1&&consent.maxFeeCents<=1000&&Date.parse(consent.issuedAt)<=now&&Date.parse(consent.expiresAt)>now;
 }
 return verifyFeeConsent(consent as FeeConsent,signature,now);
}

// Installation-backed starts follow the owner's current saved rule; the
// onchain permission and saved Limits still bound every trade.
export async function verifyStartRecord(consent:ActivationConsent|InstalledStart,signature:Hex,grant:Grant,now=Date.now()){
 if(consent.schema===INSTALLED_START){
  const lease=JSON.parse(grant.lease_json) as {owner:string;policyHash:string};
  return installed(grant,signature)&&consent.grantId===grant.id&&consent.owner===lease.owner&&consent.policyHash===lease.policyHash&&consent.sourceDigest===AUTONOMOUS_SOURCE_DIGEST&&Date.parse(consent.issuedAt)<=now&&Date.parse(consent.expiresAt)>now;
 }
 return verifyActivation(consent as ActivationConsent,signature,now);
}
export const bindsRule=(consent:{schema:string})=>consent.schema!==INSTALLED_START;
