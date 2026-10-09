import {keccak256,toHex} from 'viem';
import {compileRolesPolicy,type RolesPolicy} from './roles-permission.ts';

// Binds an installed Roles policy to the owner-confirmed mandate and the stored session signer
// record. This binds records to each other; it does not prove the encrypted signer ciphertext
// contains the key for its address, only that the grant's session is the stored signer's address.
export type MandateSnapshot={owner:string;version:number;policyJson:string};
export type SessionSignerRef={address:string;ciphertextRef:string};
export type PolicyLease={
  schema:'stock-steward-policy-lease-v1';
  owner:string;account:string;session:string;roleKey:string;grantId:string;policyHash:string;
  mandateVersion:number;mandateDigest:string;
  signerCiphertextRef:string;
  boundAt:string;
  state:'active'|'revoked';
  revocationDigest:string|null;
  revokedAt:string|null;
};
const digest=(value:unknown)=>keccak256(toHex(JSON.stringify(value)));
const address=(s:string)=>/^0x[0-9a-f]{40}$/i.test(s)&&!/^0x0{40}$/i.test(s);

export function mandateDigest(m:MandateSnapshot){
 if(!address(m.owner)||!Number.isSafeInteger(m.version)||m.version<1||typeof m.policyJson!=='string'||!m.policyJson||m.policyJson.length>100000)throw Error('Invalid mandate snapshot');
 return digest({schema:'stock-steward-mandate-v1',owner:m.owner.toLowerCase(),version:m.version,policyJson:m.policyJson});
}

export function bindPolicyLease(mandate:MandateSnapshot,signer:SessionSignerRef,policy:RolesPolicy,boundAt=new Date().toISOString()):PolicyLease{
 if(!address(signer.address)||!signer.ciphertextRef||signer.ciphertextRef.length>200)throw Error('Invalid stored signer reference');
 // The grant's session must be exactly the stored session signer's address.
 if(policy.session.toLowerCase()!==signer.address.toLowerCase())throw Error('Policy session is not the stored signer address');
 // The lease binds the exact compiled policy: recompile and refuse any drift between plan and policy.
 const plan=compileRolesPolicy(policy);
 return {
  schema:'stock-steward-policy-lease-v1',
  owner:mandate.owner.toLowerCase(),account:policy.account.toLowerCase(),session:policy.session.toLowerCase(),
  roleKey:plan.roleKey,grantId:policy.grantId,policyHash:plan.policyHash,
  mandateVersion:mandate.version,mandateDigest:mandateDigest(mandate),
  signerCiphertextRef:signer.ciphertextRef,
  boundAt,state:'active',revocationDigest:null,revokedAt:null,
 };
}

// Revoke-before-replace: a fresh grant may become installable only after every earlier grant for
// the same owner and account is revoked through its own exact revocation call.
export function revokePolicyLease(lease:PolicyLease,policy:RolesPolicy,revocation:{revocationDigest:string;revokedAt:string}):PolicyLease{
 if(lease.state!=='active')throw Error('Lease is not active');
 const plan=compileRolesPolicy(policy);
 if(lease.policyHash!==plan.policyHash||lease.roleKey!==plan.roleKey)throw Error('Revocation policy does not match the lease');
 if(revocation.revocationDigest.toLowerCase()!==digest({to:plan.revocation.to,data:plan.revocation.data}).toLowerCase())throw Error('Revocation does not match the exact revoke call');
 if(!Number.isFinite(Date.parse(revocation.revokedAt)))throw Error('Invalid revocation time');
 return {...lease,state:'revoked',revocationDigest:revocation.revocationDigest.toLowerCase(),revokedAt:revocation.revokedAt};
}

export function installablePolicyLease(existing:PolicyLease[],candidate:PolicyLease,observedMandate:MandateSnapshot,now=Date.now()):{installable:boolean;reason:string}{
 if(candidate.state!=='active')return {installable:false,reason:'Only an active lease can be installed.'};
 for(const lease of existing)if(lease.owner===candidate.owner&&lease.account===candidate.account&&lease.state==='active')return {installable:false,reason:'An earlier grant is still active. Two coexisting grants would add their budgets; revoke the old grant first.'};
 // The mandate the owner confirmed at bind time must still be the saved mandate at install time.
 let observedDigest:string;
 try{observedDigest=mandateDigest(observedMandate);}catch{return {installable:false,reason:'Observed mandate is missing or invalid.'};}
 if(observedMandate.version!==candidate.mandateVersion||observedDigest.toLowerCase()!==candidate.mandateDigest.toLowerCase())return {installable:false,reason:'Saved boundaries changed or are absent since this lease was bound.'};
 if(!Number.isFinite(Date.parse(candidate.boundAt))||now-Date.parse(candidate.boundAt)<0||now-Date.parse(candidate.boundAt)>86400000)return {installable:false,reason:'Lease binding is stale; rebind against a fresh owner confirmation.'};
 return {installable:true,reason:'No coactive grant, mandate unchanged and binding is fresh.'};
}
