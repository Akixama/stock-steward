import {encodeFunctionData,decodeFunctionResult,parseAbi, type Hex} from 'viem';
import {CHAIN} from './robinhood-chain.ts';
import {rolesOperation} from './roles-operation.ts';
import type {RouteEvidence} from './chain-route.ts';
import type {RolesPolicy} from './roles-permission.ts';
import type {PriceBound} from './live-accounting.ts';
const abi=parseAbi(['function gasEstimateComponents(address to, bool contractCreation, bytes data) returns (uint64 gasEstimate, uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)']);
// Arbitrum's total gas estimate already includes the L1 posting component.
// The component is reported separately for inspection, never added twice.
export function feeCeiling(total:bigint,l1:bigint,estimate:bigint,base:bigint,priority:bigint,price:PriceBound,now=Date.now()){
 if(total<=0n||l1<0n||l1>total||estimate<=0n||base<=0n||priority<0n||!/^\d{1,78}$/.test(price.upperMicroUsd)||BigInt(price.upperMicroUsd)<=0n||!Number.isFinite(Date.parse(price.priceAt))||now-Date.parse(price.priceAt)<0||now-Date.parse(price.priceAt)>30000)throw Error('Complete fresh fee evidence is required.');
 const gas=((total>estimate?total:estimate)*120n+99n)/100n,maxFeePerGas=base*2n+priority;
 if(gas>10000000n)throw Error('Gas estimate exceeds supported ceiling.');
 const maximumGasCostWei=gas*maxFeePerGas,maximumMicroUsd=(maximumGasCostWei*BigInt(price.upperMicroUsd)+10n**18n-1n)/10n**18n;
 return {gas,maxFeePerGas,maxPriorityFeePerGas:priority,maximumGasCostWei,maximumMicroUsd};
}
export async function inspectExecutionFees(route:RouteEvidence,version:number,policy:RolesPolicy,price:PriceBound,rpc:typeof fetch=fetch,now=Date.now()){
 if(Date.parse(route.expiresAt)<=now||now-Date.parse(route.observedAt)<0||now-Date.parse(route.observedAt)>30000)throw Error('Fresh route required for fee inspection.');
 const op=rolesOperation(route,version,policy),call={from:op.from,to:op.to,data:op.data,value:op.value};let serial=0;
 async function batch(calls:{method:string;params:unknown[]}[]){const payload=calls.map(c=>({...c,id:++serial,jsonrpc:'2.0'}));const r=await rpc(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),cache:'no-store'});const b=await r.json() as {id:number;result:unknown;error?:unknown}[];if(!r.ok||!Array.isArray(b)||b.length!==payload.length||new Set(b.map(v=>v.id)).size!==b.length)throw Error('Fee RPC evidence unavailable.');return payload.map(c=>{const row=b.find(v=>v.id===c.id);if(!row||row.error||!Object.hasOwn(row,'result'))throw Error('Fee RPC evidence unavailable.');return row.result;});}
 const data=encodeFunctionData({abi,functionName:'gasEstimateComponents',args:[op.to,false,op.data]});
 const [network,components,estimate,priority,nonce,balance,simulation]=await batch([
  {method:'eth_chainId',params:[]},
  {method:'eth_call',params:[{from:op.from,to:'0x00000000000000000000000000000000000000c8',data},route.block]},
  {method:'eth_estimateGas',params:[call,route.block]},
  {method:'eth_maxPriorityFeePerGas',params:[]},
  {method:'eth_getTransactionCount',params:[op.from,'pending']},
  {method:'eth_getBalance',params:[op.from,'pending']},
  {method:'eth_call',params:[call,route.block]},
 ]);
 if(network!==CHAIN.hex||simulation!=='0x'+'0'.repeat(63)+'1'||typeof components!=='string'||!/^0x[0-9a-f]+$/i.test(components))throw Error('Fee envelope simulation failed.');
 const values=[estimate,priority,nonce,balance];if(values.some(v=>typeof v!=='string'||!/^0x[0-9a-f]+$/i.test(v)))throw Error('Incomplete fee quantities.');
 const [total,l1,base,l1Base]=decodeFunctionResult({abi,functionName:'gasEstimateComponents',data:components as Hex});
 const fees=feeCeiling(total,l1,BigInt(estimate as string),base,BigInt(priority as string),price,now),n=BigInt(nonce as string);
 if(n>BigInt(Number.MAX_SAFE_INTEGER)||l1Base<0n)throw Error('Invalid session nonce or posting fee.');
 const [header]=await batch([{method:'eth_getBlockByNumber',params:[route.block,false]}]);
 if((header as {hash?:string})?.hash?.toLowerCase()!==route.blockHash.toLowerCase()||Date.parse(route.expiresAt)<=Date.now())throw Error('Fee quote block changed or expired.');
 return {nonce:Number(n),gas:fees.gas.toString(),maxFeePerGas:fees.maxFeePerGas.toString(),maxPriorityFeePerGas:fees.maxPriorityFeePerGas.toString(),maximumGasCostWei:fees.maximumGasCostWei.toString(),maximumMicroUsd:fees.maximumMicroUsd.toString(),postingGas:l1.toString(),postingBaseFee:l1Base.toString(),sessionFunded:BigInt(balance as string)>=fees.maximumGasCostWei,ownerReviewed:false as const,executionEnabled:false as const};
}
