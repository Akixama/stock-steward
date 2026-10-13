import {recoverMessageAddress,type Hex} from 'viem';
import {AUTONOMOUS_SOURCE_DIGEST} from './autonomous-release-manifest.ts';
export type ReleaseKind='eligibility'|'security'|'rehearsal';
export type ReleaseProof={schema:'stock-steward-release-proof-v1';kind:ReleaseKind;chainId:4663;owner:string;account:string;grantId:string;policyHash:string;sourceDigest:string;reference:string;issuedAt:string;expiresAt:string;passed:true};
export type ReviewAuthorities=Partial<Record<ReleaseKind,string>>;
export function releaseProofMessage(p:ReleaseProof){
 if(p.schema!=='stock-steward-release-proof-v1'||!['eligibility','security','rehearsal'].includes(p.kind)||p.chainId!==4663||p.passed!==true||![p.owner,p.account].every(a=>/^0x[0-9a-f]{40}$/i.test(a))||!p.grantId||p.grantId.length>100||!/^0x[0-9a-f]{64}$/i.test(p.policyHash)||!/^0x[0-9a-f]{64}$/i.test(p.sourceDigest)||!/^https:\/\/[^\s]{1,1000}$/.test(p.reference)||!Number.isFinite(Date.parse(p.issuedAt))||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=Date.parse(p.issuedAt)||Date.parse(p.expiresAt)-Date.parse(p.issuedAt)>172800000)throw Error('Invalid release evidence.');
 return ['Stock Steward — independent release evidence',JSON.stringify(p)].join('\n');
}
export async function verifyReleaseProof(p:ReleaseProof,signature:Hex,authorities:ReviewAuthorities,binding:{owner:string;account:string;grantId:string;policyHash:string},now=Date.now()){
 try{const message=releaseProofMessage(p),authority=authorities[p.kind];if(!authority||!/^0x[0-9a-f]{40}$/i.test(authority)||authority.toLowerCase()===p.owner.toLowerCase()||authority.toLowerCase()===p.account.toLowerCase()||p.owner.toLowerCase()!==binding.owner.toLowerCase()||p.account.toLowerCase()!==binding.account.toLowerCase()||p.grantId!==binding.grantId||p.policyHash.toLowerCase()!==binding.policyHash.toLowerCase()||p.sourceDigest!==AUTONOMOUS_SOURCE_DIGEST||Date.parse(p.issuedAt)>now||Date.parse(p.expiresAt)<=now)return false;return (await recoverMessageAddress({message,signature})).toLowerCase()===authority.toLowerCase();}catch{return false;}
}
export async function releaseProofChecks(rows:{kind:string;evidence_json:string;signature:Hex}[],authorities:ReviewAuthorities,binding:{owner:string;account:string;grantId:string;policyHash:string},now=Date.now()){
 const result={eligibility:false,security:false,rehearsal:false};for(const kind of ['eligibility','security','rehearsal'] as const){const row=rows.find(r=>r.kind===kind);if(!row)continue;try{const proof=JSON.parse(row.evidence_json) as ReleaseProof;if(proof.kind===kind)result[kind]=await verifyReleaseProof(proof,row.signature,authorities,binding,now);}catch{}}
 return result;
}
