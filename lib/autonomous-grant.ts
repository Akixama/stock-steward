import {encodeFunctionData,keccak256,pad,parseAbi,toHex,type Address,type Hex} from 'viem';
import {compileRolesPolicy,type RolesPolicy} from './roles-permission.ts';
import {encodeBatch} from './install-flow.ts';
import {MULTISEND} from './safe-setup.ts';
import {mandateDigest,bindPolicyLease,type MandateSnapshot,type SessionSignerRef} from './policy-lease.ts';
import {AUTONOMOUS_RELEASE_ENABLED} from './autonomous-live.ts';
import {PERMISSION_WINDOW_DAYS,isSessionWindowDays} from './permission-window.ts';
import {AUTO_ORDER_CEILING_CENTS,AUTO_DAILY_CEILING_CENTS} from './automatic-stages.ts';
const abi=parseAbi(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)']);
const ZERO='0x0000000000000000000000000000000000000000' as const;
// Draft only, never submitted. First enrollment replaces the owner's bounded role
// with a separately stored session role in the same atomic owner-signed batch.
// The Safe remains owned by the owner; the session receives no administration rights.
export function draftAutonomousGrant(snapshot:MandateSnapshot,signer:SessionSignerRef,previous:RolesPolicy,approvedOutputs:{symbol:string;token:string}[],now=new Date(),settlementUpperMicroUsd=1000000n,autoCaps?:{orderCents:number;dailyCents:number;days?:number;totalCents?:number}){
 mandateDigest(snapshot);const previousCompiled=compileRolesPolicy(previous);
 if(snapshot.owner.toLowerCase()!==previous.session.toLowerCase()||signer.address.toLowerCase()===snapshot.owner.toLowerCase()||signer.address.toLowerCase()===previous.account.toLowerCase())throw Error('First enrollment requires the owner role and a separate session key.');
 const mandate=JSON.parse(snapshot.policyJson) as {version?:number;allowedSymbols?:string[];maxOrderCents?:number;maxDailyBuyCents?:number};
 if(mandate.version!==snapshot.version||!Array.isArray(mandate.allowedSymbols)||!Number.isSafeInteger(mandate.maxOrderCents)||!Number.isSafeInteger(mandate.maxDailyBuyCents)||BigInt(mandate.maxOrderCents!)*10000n!==BigInt(previous.inputRaw)||BigInt(mandate.maxDailyBuyCents!)*10000n!==BigInt(previous.dailyRaw)||BigInt(previous.totalRaw)!==BigInt(previous.dailyRaw)*2n)throw Error('Owner-reviewed limits differ from the existing permission.');
 const expected=approvedOutputs.filter(output=>mandate.allowedSymbols!.includes(output.symbol)).map(output=>output.token.toLowerCase()).sort();
 if(expected.length!==mandate.allowedSymbols.length||JSON.stringify(expected)!==JSON.stringify(previous.outputs.map(output=>output.token.toLowerCase()).sort()))throw Error('Approved stock tokens differ from the existing permission.');
 const startsAt=Math.floor(now.getTime()/86400000)*86400;
 if(settlementUpperMicroUsd<=0n||settlementUpperMicroUsd>10n**12n)throw Error('Verified settlement price bound required.');
 // Narrow token limits when USDG's conservative dollar bound is above $1.
 // Preserve the previous minimum-output rate; never silently loosen it.
 const bounded=(raw:string,cents:number)=>{const ceiling=BigInt(cents)*10000n*1000000n/settlementUpperMicroUsd;return (ceiling<BigInt(raw)?ceiling:BigInt(raw)).toString();};
 const orderCents=Math.min(mandate.maxOrderCents!,autoCaps?.orderCents??mandate.maxOrderCents!);
 const dailyCents=Math.min(mandate.maxDailyBuyCents!,autoCaps?.dailyCents??mandate.maxDailyBuyCents!);
 if(autoCaps&&(autoCaps.orderCents>AUTO_ORDER_CEILING_CENTS||autoCaps.dailyCents>AUTO_DAILY_CEILING_CENTS))throw Error('Automatic cap exceeds the platform ceiling.');
 const days=autoCaps?.days??PERMISSION_WINDOW_DAYS;if(!isSessionWindowDays(days))throw Error('Choose 2, 7, 14 or 30 days.');
 const inputRaw=bounded(previous.inputRaw,orderCents),dailyRaw=bounded(previous.dailyRaw,dailyCents);
 // The whole permission can never spend more than the total cap, even over 30 days.
 const fullRaw=BigInt(dailyRaw)*BigInt(days),totalCap=autoCaps?.totalCents!==undefined?BigInt(bounded(fullRaw.toString(),autoCaps.totalCents)):fullRaw,totalRaw=(totalCap<fullRaw?totalCap:fullRaw).toString();
 if(BigInt(totalRaw)<BigInt(inputRaw))throw Error('Total cap is below one trade.');
 if(BigInt(inputRaw)<=0n)throw Error('Purchase limit is too small for the settlement bound.');
 const outputs=previous.outputs.map(output=>({...output,minimumOutputRaw:((BigInt(output.minimumOutputRaw)*BigInt(inputRaw)+BigInt(previous.inputRaw)-1n)/BigInt(previous.inputRaw)).toString()}));
 const policy:RolesPolicy={...previous,sales:undefined,inputRaw,dailyRaw,totalRaw,outputs,session:signer.address as Address,startsAt,expiresAt:startsAt+days*86400,grantId:keccak256(toHex(JSON.stringify(['stock-steward-autonomous-grant-v1',snapshot.owner.toLowerCase(),snapshot.version,signer.address.toLowerCase(),startsAt])))};
 const compiled=compileRolesPolicy(policy),lease=bindPolicyLease(snapshot,signer,policy,now.toISOString());
 const calls=[previousCompiled.revocation,...compiled.calls] as {to:Address;data:Hex}[];
 const signatures=(pad(snapshot.owner as Address,{size:32})+'0'.repeat(64)+'01') as Hex;
 const data=encodeFunctionData({abi,functionName:'execTransaction',args:[MULTISEND.address,0n,encodeBatch(calls),1,0n,0n,0n,ZERO,ZERO,signatures]});
 return {mode:'draft' as const,activationEnabled:AUTONOMOUS_RELEASE_ENABLED,policy,lease,from:snapshot.owner,to:previous.account,value:'0x0' as const,data,calls,notice:'Owner approval would replace the existing owner purchase role with this session role. Your Safe ownership remains unchanged. This draft grants nothing.'};
}
