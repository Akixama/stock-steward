import {encodeFunctionData,decodeFunctionResult,parseAbi,type Address,type Hex} from 'viem';
import {VENUE,poolIdentity} from './chain-route.ts';
import {CHAIN} from './robinhood-chain.ts';
import {memecoin,MEMECOIN_FLOOR_BPS} from './memecoin-list.ts';
import type {PriceBound} from './live-accounting.ts';
import type {TokenPrice} from './chain-analysis.ts';

// Memecoins have no Robinhood stock quote. Their price comes from the same
// no-hooks USDG pool Steward trades: buy $100 of the coin, then sell those
// tokens back. The buy side is the upper bound, the sell side the lower one.
// USDG is counted as $1. A pool price can be pushed around inside one block,
// so this is used for valuation and limits, never to size an order.
const quoterAbi=parseAbi(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)']);
const PROBE_USDG_RAW=100_000_000n;// $100 at 6 decimals
const TOKEN=10n**18n;
export type EthCall=(to:string,data:Hex)=>Promise<unknown>;

export function rpcEthCall(fetcher:typeof fetch,block='latest'):EthCall{
 return async(to,data)=>{
  const r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to,data},block]}),signal:AbortSignal.timeout(10000),cache:'no-store'});
  if(!r.ok)throw Error('RPC unavailable');
  const b=await r.json() as {result?:unknown;error?:unknown};if(b.error)throw Error('RPC rejected');return b.result;
 };
}

// Micro-USD per whole token (18 decimals), or null when the pool cannot quote.
export async function memecoinQuote(symbol:string,call:EthCall):Promise<{bidMicro:bigint;askMicro:bigint}|null>{
 const coin=memecoin(symbol);if(!coin?.tradable||!coin.pool)return null;
 try{
  const id=poolIdentity(coin.contract as Address,coin.pool.fee,coin.pool.tickSpacing);
  const quote=async(zeroForOne:boolean,amount:bigint)=>{
   const raw=await call(VENUE.quoter,encodeFunctionData({abi:quoterAbi,functionName:'quoteExactInputSingle',args:[{poolKey:id.key,zeroForOne,exactAmount:amount,hookData:'0x'}]}));
   if(typeof raw!=='string'||!/^0x[0-9a-f]+$/i.test(raw))throw Error('Quote unavailable');
   return (decodeFunctionResult({abi:quoterAbi,functionName:'quoteExactInputSingle',data:raw as Hex}) as readonly [bigint,bigint])[0];
  };
  const tokensOut=await quote(id.zeroForOne,PROBE_USDG_RAW);if(tokensOut<=0n)return null;
  const usdgBack=await quote(!id.zeroForOne,tokensOut);
  const askMicro=(PROBE_USDG_RAW*TOKEN+tokensOut-1n)/tokensOut,bidMicro=usdgBack*TOKEN/tokensOut;
  if(bidMicro<=0n||askMicro<bidMicro)return null;
  return {bidMicro,askMicro};
 }catch{return null;}
}

export async function memecoinPriceBound(symbol:string,call:EthCall,now=Date.now()):Promise<PriceBound|null>{
 const q=await memecoinQuote(symbol,call);if(!q)return null;
 return {upperMicroUsd:q.askMicro.toString(),lowerMicroUsd:q.bidMicro.toString(),priceAt:new Date(now).toISOString(),source:`On-chain ${symbol}/USDG Uniswap v4 quote, $100 each way (USDG counted as $1)`};
}

// Home's wallet value uses the same shape as a stock quote, with a multiplier of 1.
export function memecoinTokenPrice(raw:string,decimals:number|null,q:{bidMicro:bigint;askMicro:bigint}|null,now=Date.now()):TokenPrice{
 const empty:TokenPrice={state:'unavailable',generatedAt:null,bid:null,ask:null,multiplier:'1',tokenMid18:null,valueMicroUsd:null,reason:'The memecoin pool could not be quoted right now.'};
 if(!q||decimals===null)return empty;
 const decimal=(micro:bigint)=>`${micro/1_000_000n}.${(micro%1_000_000n).toString().padStart(6,'0')}`;
 const mid18=(q.bidMicro+q.askMicro)*TOKEN/2_000_000n;
 const value=BigInt(raw)*(q.bidMicro+q.askMicro)/2n/(10n**BigInt(decimals));
 return {state:'fresh',generatedAt:new Date(now).toISOString(),bid:decimal(q.bidMicro),ask:decimal(q.askMicro),multiplier:'1',tokenMid18:mid18.toString(),valueMicroUsd:value.toString(),reason:'Midpoint of an on-chain $100 buy and sell quote in the coin’s USDG pool. Not an executable price.'};
}

// The minimum-tokens floor locked into the permission for one output.
export function permissionFloorRaw(symbol:string,route:{best:{outputRaw?:string}|null;minimumOutputRaw:string|null}):string|null{
 if(!memecoin(symbol))return route.minimumOutputRaw;
 if(!route.best?.outputRaw)return null;
 return (BigInt(route.best.outputRaw)*BigInt(10000-MEMECOIN_FLOOR_BPS)/10000n).toString();
}
