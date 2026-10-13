import {recoverMessageAddress,type Hex} from 'viem';
export type FeeConsent={schema:'stock-steward-fee-consent-v1';origin:string;owner:string;grantId:string;policyHash:string;maxFeeCents:number;issuedAt:string;expiresAt:string};
export function feeConsentMessage(c:FeeConsent){
 if(c.schema!=='stock-steward-fee-consent-v1'||!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(c.origin)||!/^0x[0-9a-f]{40}$/i.test(c.owner)||!c.grantId||c.grantId.length>100||!/^0x[0-9a-f]{64}$/i.test(c.policyHash)||!Number.isSafeInteger(c.maxFeeCents)||c.maxFeeCents<1||c.maxFeeCents>1000||!Number.isFinite(Date.parse(c.issuedAt))||!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=Date.parse(c.issuedAt)||Date.parse(c.expiresAt)-Date.parse(c.issuedAt)>172800000)throw Error('Invalid fee approval.');
 return ['Stock Steward — network fee approval',c.origin,`Owner: ${c.owner.toLowerCase()}`,`Session grant: ${c.grantId}`,`Policy: ${c.policyHash.toLowerCase()}`,`Maximum network fee per transaction: ${c.maxFeeCents} USD cents`,`Issued: ${c.issuedAt}`,`Expires: ${c.expiresAt}`,'This message approves this fee ceiling only. It does not activate trading or move funds.'].join('\n');
}
export async function verifyFeeConsent(c:FeeConsent,signature:Hex,now=Date.now(),fresh=false){
 try{const message=feeConsentMessage(c),issued=Date.parse(c.issuedAt);if(now<issued||now>=Date.parse(c.expiresAt)||(fresh&&now-issued>300000))return false;return (await recoverMessageAddress({message,signature})).toLowerCase()===c.owner.toLowerCase();}catch{return false;}
}
