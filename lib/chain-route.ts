import {encodeFunctionData,decodeFunctionResult,encodeAbiParameters,keccak256,parseAbi,parseUnits,formatUnits,type Address,type Hex} from 'viem';
import {CHAIN,registry} from './robinhood-chain.ts';
export const VENUE={manager:'0x8366a39cc670b4001a1121b8f6a443a643e40951',quoter:'0x8dc178efb8111bb0973dd9d722ebeff267c98f94',state:'0xf3334192d15450cdd385c8b70e03f9a6bd9e673b',settlement:'0x5fc5360d0400a0fd4f2af552add042d716f1d168'} as const;
const ZERO='0x0000000000000000000000000000000000000000' as Address;
const stateAbi=parseAbi(['function getLiquidity(bytes32) view returns (uint128)','function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)','function poolManager() view returns (address)']);
const quoteAbi=parseAbi(['function poolManager() view returns (address)','function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)']);
const ercAbi=parseAbi(['function decimals() view returns (uint8)','function balanceOf(address) view returns (uint256)']);
export type PoolProbe={fee:number;tickSpacing:number;poolId:string;state:'quoted'|'uninitialized'|'no_active_liquidity'|'unavailable';liquidity?:string;outputRaw?:string;outputTokens?:string;quoterGas?:string;reason:string};
export type RouteEvidence={id:string;chainId:number;address:string;symbol:string;token:string;settlement:string;input:string;inputRaw:string;settlementDecimals:number;block:string;blockHash:string;blockAt:string;observedAt:string;expiresAt:string;balanceRaw:string;slippageBps:number;probes:PoolProbe[];best:PoolProbe|null;minimumOutputRaw:string|null;executionEnabled:false;coverage:string;blockers:string[]};
export function routeAmount(amount:string,decimals:number){if(!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,18})?$/.test(amount)||amount.split('.')[1]?.length>decimals)throw new Error('Enter an exact positive USDG token amount.');const raw=parseUnits(amount,decimals);if(raw<=0n||raw>2n**128n-1n)throw new Error('Amount outside supported range.');return raw;}
export function poolIdentity(token:Address,fee:number,tickSpacing:number){const currencies=[VENUE.settlement,token.toLowerCase()].sort() as [Address,Address];const key={currency0:currencies[0],currency1:currencies[1],fee,tickSpacing,hooks:ZERO};const poolId=keccak256(encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint24'},{type:'int24'},{type:'address'}],[key.currency0,key.currency1,fee,tickSpacing,ZERO]));return {key,poolId,zeroForOne:key.currency0===VENUE.settlement};}
type BatchRow={result:unknown}|{error:unknown};
// One HTTP round trip for many read-only calls. Workers cap subrequests per
// invocation, so the dozen reads below travel as a single request; row-level
// failures stay per-row so one bad pool never sinks the others.
async function rpcBatch(fetcher:typeof fetch,calls:{method:string;params:unknown[]}[]):Promise<BatchRow[]>{
 const payload=calls.map((call,index)=>({...call,jsonrpc:'2.0',id:index+1}));
 const r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(!r.ok)throw new Error('Route RPC unavailable');
 const body=await r.json() as {id?:number;result?:unknown;error?:unknown}|{id?:number;result?:unknown;error?:unknown}[];
 const rows=Array.isArray(body)?body:[body];
 return payload.map((call)=>{const row=rows.find((entry)=>entry.id===call.id);return row&&!row.error&&row.result!==undefined?{result:row.result}:{error:row?.error??'missing'};});
}
function need(row:BatchRow):unknown{
 if('error' in row)throw new Error('Route RPC evidence unavailable');
 return (row as {result:unknown}).result;
}
function hexBytes(raw:unknown):string{
 if(typeof raw!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(raw))throw new Error('Contract response unavailable');
 return raw;
}
export async function inspectRoute(address:string,symbol:string,amount:string,slippageBps=50,fetcher:typeof fetch=fetch):Promise<RouteEvidence>{
 if(!/^0x[0-9a-f]{40}$/i.test(address)||! /^[A-Z0-9.-]{1,12}$/.test(symbol)||!Number.isInteger(slippageBps)||slippageBps<1||slippageBps>100)throw new Error('Invalid route request.');
 let serial=0;async function rpc(method:string,params:unknown[]){const id=++serial;const r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(12000),cache:'no-store'});if(!r.ok)throw new Error('Route RPC unavailable');const b=await r.json() as {id:number;result:unknown;error?:unknown};if(b.id!==id||b.error||b.result===undefined)throw new Error('Route RPC evidence unavailable');return b.result;}
 const [chainIdRow,blockRow]=await rpcBatch(fetcher,[{method:'eth_chainId',params:[]},{method:'eth_blockNumber',params:[]}]);
 if(BigInt(String(need(chainIdRow)))!==BigInt(CHAIN.id))throw new Error('Wrong network');
 const block=String(need(blockRow));if(!/^0x[0-9a-f]+$/i.test(block))throw new Error('Invalid block');
 const header=await rpc('eth_getBlockByNumber',[block,false]) as {hash?:string;number?:string;timestamp?:string};if(header.number!==block||!/^0x[0-9a-f]{64}$/i.test(header.hash??'')||!/^0x[0-9a-f]+$/i.test(header.timestamp??'')||Math.abs(Date.now()-Number(BigInt(header.timestamp!))*1000)>120000)throw new Error('Current canonical block unavailable');
 const r=await fetcher('https://api.robinhood.com/rhj/assets',{signal:AbortSignal.timeout(12000),cache:'no-store'});if(!r.ok)throw new Error('Official asset registry unavailable');const asset=registry(await r.json()).find(t=>t.symbol===symbol);if(!asset||asset.status!=='ASSET_STATUS_ACTIVE')throw new Error('Active official stock token not found');
 const codes=await rpcBatch(fetcher,[VENUE.manager,VENUE.quoter,VENUE.state,VENUE.settlement,asset.contract].map((contract)=>({method:'eth_getCode',params:[contract,block]})));
 for(const row of codes){const code=hexBytes(need(row));if(code==='0x')throw new Error('Required contract unavailable');}
 const managers=await rpcBatch(fetcher,[[VENUE.state,stateAbi],[VENUE.quoter,quoteAbi]].map(([target,abi])=>({method:'eth_call',params:[{to:target,data:encodeFunctionData({abi,functionName:'poolManager',args:[]} as never)},block]})));
 for(const row of managers){if(String(decodeFunctionResult({abi:stateAbi,functionName:'poolManager',data:hexBytes(need(row)) as Hex} as never)).toLowerCase()!==VENUE.manager)throw new Error('Venue manager mismatch');}
 const encoded=(to:Address,abi:typeof ercAbi,name:string,args:unknown[]=[])=>({method:'eth_call',params:[{to,data:encodeFunctionData({abi,functionName:name,args} as never)},block]});
 const [decRow,stockDecRow,balRow]=await rpcBatch(fetcher,[encoded(VENUE.settlement,ercAbi,'decimals'),encoded(asset.contract as Address,ercAbi,'decimals'),encoded(VENUE.settlement,ercAbi,'balanceOf',[address])]);
 const decimals=Number(decodeFunctionResult({abi:ercAbi,functionName:'decimals',data:hexBytes(need(decRow)) as Hex} as never));if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw new Error('Settlement decimals unavailable');const raw=routeAmount(amount,decimals);
 const stockDecimals=Number(decodeFunctionResult({abi:ercAbi,functionName:'decimals',data:hexBytes(need(stockDecRow)) as Hex} as never));if(stockDecimals!==18)throw new Error('Stock token decimals mismatch');
 const balance=BigInt(String(decodeFunctionResult({abi:ercAbi,functionName:'balanceOf',data:hexBytes(need(balRow)) as Hex} as never) as bigint));const tiers=[[100,1],[500,10],[3000,60],[10000,200]] as const;
 const keys=tiers.map(([fee,tickSpacing])=>({fee,tickSpacing,...poolIdentity(asset.contract as Address,fee,tickSpacing)}));
 const slotRows=await rpcBatch(fetcher,keys.map(({poolId})=>({method:'eth_call',params:[{to:VENUE.state,data:encodeFunctionData({abi:stateAbi,functionName:'getSlot0',args:[poolId]} as never)},block]})));
 const liquid:{index:number;key:(typeof keys)[number]}[]=[];
 const probes:PoolProbe[]=keys.map(({fee,tickSpacing,poolId},index)=>{
  const probe:PoolProbe={fee,tickSpacing,poolId,state:'unavailable',reason:'RPC or quote unavailable; no absence of liquidity inferred.'};
  try{
   const slot=decodeFunctionResult({abi:stateAbi,functionName:'getSlot0',data:hexBytes(need(slotRows[index])) as Hex} as never) as readonly [bigint,number,number,number];
   if(slot[0]===0n)return {...probe,state:'uninitialized' as const,reason:'This exact pool key is not initialized at the observed block.'};
   liquid.push({index,key:keys[index]});
  }catch{/* Per-pool failure stays per-pool. */}
  return probe;
 });
 if(liquid.length){
  const liqRows=await rpcBatch(fetcher,liquid.map(({key})=>({method:'eth_call',params:[{to:VENUE.state,data:encodeFunctionData({abi:stateAbi,functionName:'getLiquidity',args:[key.poolId]} as never)},block]})));
  const quoted:{index:number;key:(typeof keys)[number]}[]=[];
  liquid.forEach(({index,key},at)=>{
   try{
    const liquidity=decodeFunctionResult({abi:stateAbi,functionName:'getLiquidity',data:hexBytes(need(liqRows[at])) as Hex} as never) as bigint;
    probes[index].liquidity=liquidity.toString();
    if(liquidity===0n){probes[index]={...probes[index],state:'no_active_liquidity' as const,reason:'No active liquidity at the current tick for this key.'};return;}
    quoted.push({index,key});
   }catch{/* Per-pool failure stays per-pool. */}
  });
  if(quoted.length){
   const quoteRows=await rpcBatch(fetcher,quoted.map(({key})=>({method:'eth_call',params:[{to:VENUE.quoter,data:encodeFunctionData({abi:quoteAbi,functionName:'quoteExactInputSingle',args:[{poolKey:key.key,zeroForOne:key.zeroForOne,exactAmount:raw,hookData:'0x'}]} as never)},block]})));
   quoted.forEach(({index},at)=>{
    try{
     const [output,gas]=decodeFunctionResult({abi:quoteAbi,functionName:'quoteExactInputSingle',data:hexBytes(need(quoteRows[at])) as Hex} as never) as readonly [bigint,bigint];
     if(output<=0n)throw new Error('Empty quote');
     probes[index]={...probes[index],state:'quoted' as const,outputRaw:output.toString(),outputTokens:formatUnits(output,18),quoterGas:gas.toString(),reason:'Read-only single-pool quoter simulation. Not a full wallet transaction simulation.'};
    }catch{/* Per-pool failure stays per-pool. */}
   });
  }
 }
 const best=probes.filter(p=>p.state==='quoted').sort((a,b)=>BigInt(a.outputRaw!)>BigInt(b.outputRaw!)?-1:1)[0]??null;
 const end=await rpc('eth_getBlockByNumber',[block,false]) as {hash?:string};if(end.hash!==header.hash)throw new Error('Block changed during inspection');const now=Date.now();
 const blockers=['Owner authority and bounded onchain permissions are unverified.','Eligibility for this user and trading venue has not been established.','Allowance, full router/account simulation and complete execution fees remain unverified.','Daily budget and portfolio concentration must be rechecked before execution.'];if(BigInt(String(balance))<raw)blockers.unshift('Insufficient observed USDG tokens.');if(!best)blockers.unshift('No quote from the four inspected direct pools. Other pools or venues may exist.');
 return {id:crypto.randomUUID(),chainId:CHAIN.id,address:address.toLowerCase(),symbol,token:asset.contract,settlement:VENUE.settlement,input:amount,inputRaw:raw.toString(),settlementDecimals:decimals,block,blockHash:header.hash!,blockAt:new Date(Number(BigInt(header.timestamp!))*1000).toISOString(),observedAt:new Date(now).toISOString(),expiresAt:new Date(Math.min(now+30000,Number(BigInt(header.timestamp!))*1000+30000)).toISOString(),balanceRaw:String(balance),slippageBps,probes,best,minimumOutputRaw:best?((BigInt(best.outputRaw!)*BigInt(10000-slippageBps))/10000n).toString():null,executionEnabled:false,coverage:'Four direct USDG/stock Uniswap v4 pool keys: fixed fees 100/500/3000/10000, tick spacing 1/10/60/200, zero hooks. No RFQ, multihop or hooked-pool discovery. USDG amount is not a guaranteed USD valuation.',blockers};
}
