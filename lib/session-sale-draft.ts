import {encodeFunctionData,pad,parseAbi,type Address,type Hex} from 'viem';
import {compileRolesPolicy,type RolesPolicy} from './roles-permission.ts';
import {bindPolicyLease,type MandateSnapshot,type SessionSignerRef} from './policy-lease.ts';
import type {draftAutonomousGrant} from './autonomous-grant.ts';
import {encodeBatch} from './install-flow.ts';
import {MULTISEND} from './safe-setup.ts';
import {EXECUTION_CONTRACTS} from './autonomy.ts';
import {VENUE} from './chain-route.ts';
const erc20=parseAbi(['function approve(address spender,uint256 amount) returns (bool)']);
const permit2=parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']);
const safe=parseAbi(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)']);
export function addReviewedSales(draft:ReturnType<typeof draftAutonomousGrant>,sales:NonNullable<RolesPolicy['sales']>,snapshot:MandateSnapshot,signer:SessionSignerRef,now=new Date()){
 if(!sales.length)throw Error('At least one sale lot is required.');
 const policy={...draft.policy,sales},compiled=compileRolesPolicy(policy),lease=bindPolicyLease(snapshot,signer,policy,now.toISOString());
 const totalCalls=BigInt(policy.totalRaw)/BigInt(policy.inputRaw);
 const funding=[{token:VENUE.settlement,amount:BigInt(policy.totalRaw)},...sales.map(s=>({token:s.token,amount:BigInt(s.inputRaw)*totalCalls}))];
 const approvals:{to:Address;data:Hex}[]=[];
 for(const item of funding){if(item.amount<=0n||item.amount>=2n**160n)throw Error('Approval exceeds bounded token capacity.');
  approvals.push({to:item.token as Address,data:encodeFunctionData({abi:erc20,functionName:'approve',args:[EXECUTION_CONTRACTS.permit2,item.amount]})},{to:EXECUTION_CONTRACTS.permit2,data:encodeFunctionData({abi:permit2,functionName:'approve',args:[item.token as Address,EXECUTION_CONTRACTS.router,item.amount,policy.expiresAt]})});
 }
 const calls=[draft.calls[0],...approvals,...compiled.calls],zero='0x0000000000000000000000000000000000000000' as const;
 const signature=(pad(snapshot.owner as Address,{size:32})+'0'.repeat(64)+'01') as Hex;
 return {...draft,policy,lease,calls,data:encodeFunctionData({abi:safe,functionName:'execTransaction',args:[MULTISEND.address,0n,encodeBatch(calls),1,0n,0n,0n,zero,zero,signature]}),notice:'Unsigned buy-and-sell permission. Fixed stock quantities, minimum USDG proceeds, shared trade-count limits and token approvals are included for owner review. No trade is submitted.'};
}
