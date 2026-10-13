import {decodeErrorResult,encodeFunctionData,keccak256,parseAbi,type Hex} from 'viem';
import {rolesAbi,ROLES_CONTRACTS,ROLES_RUNTIME_HASHES} from './roles-permission.ts';
import type {ReadbackCall} from './live-order.ts';
const errors=parseAbi(['error NoMembership()','error ConditionViolation(uint8 status,bytes32 info)']);
// eth_call only: deliberately probe a forbidden zero-address target. The pinned
// runtime checks role membership before rejecting the target. No order is sent.
// Source: gnosisguild/zodiac-modifier-roles PermissionChecker._authorize.
export function withRoleMembership(call:ReadbackCall,transport:typeof fetch):ReadbackCall {
 call.membership=async(policy,roleKey,block)=>{
  async function rpc(method:string,params:unknown[]){const r=await transport('https://rpc.mainnet.chain.robinhood.com/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),cache:'no-store'});if(!r.ok)throw Error('Membership read unavailable');return await r.json() as {result?:Hex;error?:{data?:Hex}};}
  const proxy=await rpc('eth_getCode',[policy.module,block]);
  const expected='0x363d3d373d3d3d363d73'+ROLES_CONTRACTS.roles.slice(2).toLowerCase()+'5af43d82803e903d91602b57fd5bf3';
  if(proxy.result?.toLowerCase()!==expected)throw Error('Unsupported membership runtime');
  const master=await rpc('eth_getCode',[ROLES_CONTRACTS.roles,block]);
  if(!master.result||keccak256(master.result)!==ROLES_RUNTIME_HASHES.roles)throw Error('Membership runtime changed');
  const data=encodeFunctionData({abi:rolesAbi,functionName:'execTransactionWithRole',args:['0x0000000000000000000000000000000000000000',0n,'0x',0,roleKey,true]});
  const b=await rpc('eth_call',[{from:policy.session,to:policy.module,data},block]);
  if(!b.error?.data)throw Error('Membership probe unavailable');
  const e=decodeErrorResult({abi:errors,data:b.error.data});
  if(e.errorName==='NoMembership')return false;
  if(e.errorName==='ConditionViolation'&&e.args[0]===2&&BigInt(e.args[1])===0n)return true;
  throw Error('Unexpected membership evidence');
 };
 return call;
}
