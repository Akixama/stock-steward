import test from 'node:test';import assert from 'node:assert/strict';
import {decodeFunctionData,encodeFunctionData,parseAbi,decodeAbiParameters,encodeAbiParameters,parseAbiParameters,type Hex} from 'viem';
import {inspectPermissionCall,type PermissionPolicy,type PermissionCall} from './permission-policy.ts';
import {routerCandidate} from './router-candidate.ts';import {VENUE,poolIdentity,type RouteEvidence} from './chain-route.ts';
const now=1800000000,account='0x'+'1'.repeat(40),session='0x'+'2'.repeat(40),token=('0x'+'3'.repeat(40)) as Hex;
const r={id:'fixture',chainId:4663,address:account,settlement:VENUE.settlement,token,inputRaw:'1000000',minimumOutputRaw:'123',best:{state:'quoted',outputRaw:'150',fee:3000,tickSpacing:60,poolId:poolIdentity(token,3000,60).poolId},blockHash:'0x'+'a'.repeat(64),expiresAt:new Date((now+25)*1000).toISOString()} as RouteEvidence;
const candidate=routerCandidate(r,1);
const policy:PermissionPolicy={account,session,chainId:4663,expiresAt:now+3600,revoked:false,outputs:[token],perTradeRaw:'1000000',remainingTotalRaw:'2000000',remainingDailyRaw:'1000000'};
const call:PermissionCall={sender:session,account,chainId:4663,to:candidate.to,value:'0x0',operation:0,data:candidate.data};
const abi=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
const inner=parseAbiParameters('bytes actions,bytes[] params');
function mutate(commands:Hex='0x10',actions:Hex='0x060c0f',alter:(p:readonly Hex[])=>readonly Hex[]=p=>p){const [,inputs,deadline]=decodeFunctionData({abi,data:call.data}).args;const [,params]=decodeAbiParameters(inner,inputs[0]);return {...call,data:encodeFunctionData({abi,functionName:'execute',args:[commands,[encodeAbiParameters(inner,[actions,alter(params)])],deadline]})};}
test('reference policy matches canonical bounded calls without enabling authority',()=>{assert.deepEqual(inspectPermissionCall(policy,call,now).matches,true);assert.equal(inspectPermissionCall(policy,call,now).onchainEnforced,false);assert.equal(inspectPermissionCall(policy,call,now).executionEnabled,false);});
test('reject authority, expiry, revoke, daily and total bypasses',()=>{
 for(const change of [{sender:account},{account:session},{chainId:1},{operation:1},{value:'0x1'},{to:session},{data:(call.data+'00') as Hex}])assert.equal(inspectPermissionCall(policy,{...call,...change},now).matches,false);
 for(const change of [{revoked:true},{expiresAt:now},{expiresAt:now+24},{perTradeRaw:'999999'},{remainingTotalRaw:'999999'},{remainingDailyRaw:'999999'},{outputs:[session]},{perTradeRaw:'-1'},{expiresAt:NaN}])assert.equal(inspectPermissionCall({...policy,...change},call,now).matches,false);
 assert.equal(inspectPermissionCall(policy,call,now-6).matches,false);
});
test('reject router command flags, arbitrary recipient actions, extra calls and settlement mismatch',()=>{
 for(const [commands,actions] of [['0x90','0x060c0f'],['0x1010','0x060c0f'],['0x10','0x060c0e'],['0x10','0x060c0f0f']])assert.equal(inspectPermissionCall(policy,mutate(commands as Hex,actions as Hex),now).matches,false);
 const amounts=parseAbiParameters('address,uint256');
 for(const [index,encoded] of [[1,encodeAbiParameters(amounts,[session as Hex,1000000n])],[1,encodeAbiParameters(amounts,[VENUE.settlement,2000000n])],[2,encodeAbiParameters(amounts,[token,0n])],[2,encodeAbiParameters(amounts,[token,122n])]] as const)assert.equal(inspectPermissionCall(policy,mutate('0x10','0x060c0f',p=>p.map((x,i)=>i===index?encoded:x)),now).matches,false);
 assert.equal(inspectPermissionCall(policy,mutate('0x10','0x060c0f',p=>[...p,p[2]]),now).matches,false);
 assert.equal(inspectPermissionCall(policy,mutate('0x10','0x060c0f',p=>p.map((x,i)=>i===0?(x+'00') as Hex:x)),now).matches,false);
});
test('reject selector mutations and empty calldata',()=>{
 // Policy permits fresh amounts/minima within bounds; mutations must not be mistaken for exact intent approval.
 for(let i=0;i<8;i++)assert.equal(inspectPermissionCall(policy,{...call,data:('0x'+call.data.slice(2,2+i)+'f'+call.data.slice(3+i)) as Hex},now).matches,false);
 assert.equal(inspectPermissionCall(policy,{...call,data:'0x'},now).matches,false);
});
test('reject changed direction, pool fees, hooks and mismatched minima',()=>{
 const fields=parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)');
 const [,inputs]=decodeFunctionData({abi,data:call.data}).args;
 const [,params]=decodeAbiParameters(inner,inputs[0]);const [s]=decodeAbiParameters(fields,params[0]);
 for(const changed of [{...s,zeroForOne:!s.zeroForOne},{...s,poolKey:{...s.poolKey,fee:123}},{...s,poolKey:{...s.poolKey,hooks:session as Hex}},{...s,hookData:'0x12' as Hex},{...s,amountOutMinimum:122n},{...s,minHopPriceX36:1n}]){
  const altered=mutate('0x10','0x060c0f',p=>p.map((x,i)=>i===0?encodeAbiParameters(fields,[changed]):x));
  assert.equal(inspectPermissionCall(policy,altered,now).matches,false);
 }
});
