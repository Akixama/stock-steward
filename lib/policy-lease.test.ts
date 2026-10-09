import test from 'node:test';import assert from 'node:assert/strict';import {keccak256,toHex} from 'viem';import {bindPolicyLease,revokePolicyLease,installablePolicyLease,mandateDigest,type MandateSnapshot,type SessionSignerRef,type PolicyLease} from './policy-lease.ts';import {compileRolesPolicy,type RolesPolicy} from './roles-permission.ts';
const now=Date.parse('2026-10-06T12:00:00Z');
const addr=(c:string)=>('0x'+c.repeat(40)) as `0x${string}`;
const hex64=(c:string)=>('0x'+c.repeat(64)) as `0x${string}`;
const mandate=():MandateSnapshot=>({owner:addr('6'),version:3,policyJson:'{"maxDailyCents":200,"maxOrderCents":100}'});
const signer=():SessionSignerRef=>({address:addr('7'),ciphertextRef:'sessions/3/iv-ciphertext'});
const policy=():RolesPolicy=>({account:addr('9'),module:addr('8'),session:addr('7'),grantId:hex64('1'),routerCodeHash:hex64('2'),startsAt:Date.parse('2026-10-06T00:00:00Z')/1000,expiresAt:Date.parse('2026-10-07T00:00:00Z')/1000,inputRaw:'1000000',dailyRaw:'2000000',totalRaw:'3000000',outputs:[{token:addr('a'),fee:3000,tickSpacing:60,minimumOutputRaw:'123'}]});
const revokeDigest=(p:RolesPolicy)=>keccak256(toHex(JSON.stringify(compileRolesPolicy(p).revocation)));

test('a lease binds the exact compiled policy to the mandate digest and stored signer',()=>{
 const p=policy(),m=mandate(),lease=bindPolicyLease(m,signer(),p,new Date(now).toISOString());
 assert.equal(lease.state,'active');assert.equal(lease.mandateVersion,3);
 assert.equal(lease.mandateDigest,mandateDigest(m));
 const plan=compileRolesPolicy(p);
 assert.equal(lease.roleKey,plan.roleKey);assert.equal(lease.policyHash,plan.policyHash);
 assert.equal(lease.signerCiphertextRef,'sessions/3/iv-ciphertext');
 assert.deepEqual(bindPolicyLease(m,signer(),p,new Date(now).toISOString()),lease);
 assert.notEqual(mandateDigest(m),mandateDigest({...m,policyJson:'{"maxDailyCents":201}'}));
});
test('a policy whose session is not the stored signer is refused',()=>{
 assert.throws(()=>bindPolicyLease(mandate(),signer(),{...policy(),session:addr('5')}),/not the stored signer/);
 assert.throws(()=>bindPolicyLease(mandate(),{...signer(),address:addr('0')},policy()),/Invalid stored signer/);
});
test('revocation must match the exact revoke call of the bound policy',()=>{
 const p=policy(),lease=bindPolicyLease(mandate(),signer(),p,new Date(now).toISOString());
 assert.throws(()=>revokePolicyLease(lease,p,{revocationDigest:hex64('0'),revokedAt:new Date(now).toISOString()}),/exact revoke call/);
 const tampered={...p,inputRaw:'1000001'};
 assert.throws(()=>revokePolicyLease(lease,tampered,{revocationDigest:revokeDigest(tampered),revokedAt:new Date(now).toISOString()}),/does not match the lease/);
 const revoked=revokePolicyLease(lease,p,{revocationDigest:revokeDigest(p),revokedAt:new Date(now).toISOString()});
 assert.equal(revoked.state,'revoked');assert.equal(revoked.revocationDigest,revokeDigest(p));
 assert.throws(()=>revokePolicyLease(revoked,p,{revocationDigest:revokeDigest(p),revokedAt:new Date(now).toISOString()}),/not active/);
});
test('install refuses a coactive grant, mandate drift, stale binding or inactive candidate',()=>{
 const p=policy(),m=mandate(),bound=new Date(now).toISOString();
 const lease=bindPolicyLease(m,signer(),p,bound);
 assert.equal(installablePolicyLease([],lease,m,now).installable,true);
 assert.equal(installablePolicyLease([lease],{...lease},m,now).installable,false);
 const revoked=revokePolicyLease(lease,p,{revocationDigest:revokeDigest(p),revokedAt:new Date(now).toISOString()});
 const nextSession=addr('5');
 assert.equal(installablePolicyLease([revoked],bindPolicyLease(m,{...signer(),address:nextSession},{...p,session:nextSession},bound),m,now).installable,true);
 const next=bindPolicyLease(m,signer(),p,bound);
 assert.equal(installablePolicyLease([],next,{...m,version:4},now).installable,false);
 assert.equal(installablePolicyLease([],next,{...m,policyJson:'{"maxDailyCents":999}'},now).installable,false);
 const stale=bindPolicyLease(m,signer(),p,new Date(now-86400001).toISOString());
 assert.equal(installablePolicyLease([],stale,m,now).installable,false);
 assert.equal(installablePolicyLease([],next,m,now-1).installable,false);
 assert.equal(installablePolicyLease([],[{...next,state:'revoked'} as PolicyLease][0],m,now).installable,false);
});
