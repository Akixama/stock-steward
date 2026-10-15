import {encodeFunctionData,pad,parseAbi,type Address,type Hex} from 'viem';

export const transferAbi=parseAbi(['function transfer(address recipient,uint256 amount) returns (bool)']);
export const ownerSafeAbi=parseAbi([
 'function getOwners() view returns (address[])',
 'function getThreshold() view returns (uint256)',
 'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)',
]);
const zero='0x0000000000000000000000000000000000000000' as Address;

/** Move one entire ERC-20 balance from an earlier Safe to its verified EOA owner. */
export function ownerTransferTransaction(input:{safe:Address;owner:Address;token:Address;amount:bigint}){
 const {safe,owner,token,amount}=input;
 for(const address of [safe,owner,token])if(!/^0x[0-9a-f]{40}$/i.test(address)||address.toLowerCase()===zero)throw Error('Invalid transfer address.');
 if(amount<=0n)throw Error('No token balance to transfer.');
 const inner=encodeFunctionData({abi:transferAbi,functionName:'transfer',args:[owner,amount]});
 const signature=(pad(owner,{size:32})+'0'.repeat(64)+'01') as Hex;
 return {from:owner,to:safe,value:'0x0' as const,data:encodeFunctionData({abi:ownerSafeAbi,functionName:'execTransaction',args:[token,0n,inner,0,0n,0n,0n,zero,zero,signature]}),recipient:owner,token,amount:amount.toString()};
}
