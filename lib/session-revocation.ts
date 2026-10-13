import {encodeFunctionData,pad,parseAbi,type Address,type Hex} from 'viem';
import {compileRolesPolicy,type RolesPolicy} from './roles-permission.ts';
const zero='0x0000000000000000000000000000000000000000' as const;
const abi=parseAbi(['function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)']);
export function sessionRevocationTransaction(owner:Address,policy:RolesPolicy){const call=compileRolesPolicy(policy).revocation;const signatures=(pad(owner,{size:32})+'0'.repeat(64)+'01') as Hex;return {from:owner,to:policy.account,value:'0x0',data:encodeFunctionData({abi,functionName:'execTransaction',args:[call.to,0n,call.data,0,0n,0n,0n,zero,zero,signatures]})};}
