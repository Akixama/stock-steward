import {keccak256,recoverTransactionAddress,parseTransaction,type Hex,type TransactionSerialized} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {rolesOperation} from './roles-operation.ts';
import type {RouteEvidence} from './chain-route.ts';
import {compileRolesPolicy,type RolesPolicy} from './roles-permission.ts';
import {mandateDigest,type MandateSnapshot,type PolicyLease} from './policy-lease.ts';

export type SessionTransactionFees={nonce:number;gas:bigint;maxFeePerGas:bigint;maxPriorityFeePerGas:bigint;maximumGasCostWei:bigint};
// Offline signing only. This module has no RPC or broadcast implementation.
// The key must be a separate session key, never the owner's wallet key.
export async function signBoundSessionTransaction(material:Hex,route:RouteEvidence,version:number,policy:RolesPolicy,lease:PolicyLease,snapshot:MandateSnapshot,fees:SessionTransactionFees,now=Date.now()){
 const compiled=compileRolesPolicy(policy);
 const session=privateKeyToAccount(material);
 if(session.address.toLowerCase()!==policy.session.toLowerCase()||session.address.toLowerCase()===snapshot.owner.toLowerCase()||session.address.toLowerCase()===policy.account.toLowerCase())throw Error('A separate matching session signer is required.');
 if(lease.state!=='active'||lease.policyHash!==compiled.policyHash||lease.roleKey!==compiled.roleKey||lease.session.toLowerCase()!==session.address.toLowerCase()||lease.account.toLowerCase()!==policy.account.toLowerCase()||lease.owner.toLowerCase()!==snapshot.owner.toLowerCase()||lease.mandateVersion!==version||snapshot.version!==version||lease.mandateDigest!==mandateDigest(snapshot))throw Error('Session grant or mandate changed.');
 if(!Number.isFinite(now)||now<policy.startsAt*1000||now>=policy.expiresAt*1000||!Number.isFinite(Date.parse(route.expiresAt))||Date.parse(route.expiresAt)<=now||now-Date.parse(route.observedAt)<0||now-Date.parse(route.observedAt)>30000)throw Error('Session grant or quote expired.');
 if(!Number.isSafeInteger(fees.nonce)||fees.nonce<0||fees.gas<=0n||fees.gas>10000000n||fees.maxFeePerGas<=0n||fees.maxPriorityFeePerGas<0n||fees.maxPriorityFeePerGas>fees.maxFeePerGas||fees.maximumGasCostWei<=0n||fees.gas*fees.maxFeePerGas>fees.maximumGasCostWei)throw Error('Gas fees exceed the reviewed ceiling.');
 const envelope=rolesOperation(route,version,policy);
 const raw=await session.signTransaction({type:'eip1559',chainId:4663,nonce:fees.nonce,to:envelope.to,data:envelope.data,value:0n,gas:fees.gas,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});
 await verifySignedSessionTransaction(raw,envelope,session.address,fees);
 return {raw,hash:keccak256(raw),session:session.address.toLowerCase(),nonce:fees.nonce,intentDigest:envelope.intentDigest};
}
export async function verifySignedSessionTransaction(raw:Hex,envelope:{to:string;data:Hex},session:string,fees:SessionTransactionFees){
 const tx=parseTransaction(raw),sender=await recoverTransactionAddress({serializedTransaction:raw as TransactionSerialized});
 if(tx.type!=='eip1559'||tx.chainId!==4663||sender.toLowerCase()!==session.toLowerCase()||tx.to?.toLowerCase()!==envelope.to.toLowerCase()||tx.data!==envelope.data||(tx.value??0n)!==0n||tx.nonce!==fees.nonce||tx.gas!==fees.gas||tx.maxFeePerGas!==fees.maxFeePerGas||(tx.maxPriorityFeePerGas??0n)!==fees.maxPriorityFeePerGas)throw Error('Signed transaction differs from the reviewed session envelope.');
}
