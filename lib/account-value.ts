import type {Hex} from 'viem';
import {executionAccountingSources} from './execution-sources.ts';
import {latestStrategyAnchor} from './live-strategy-runtime.ts';
// Conservative account value: every holding at its verified lower price bound.
// Returns null when any held asset cannot be priced, so callers fail closed.
export async function accountValueMicro(account:Hex,rpc:typeof fetch=fetch,web:typeof fetch=fetch):Promise<bigint|null>{
 try{
  const sources=await executionAccountingSources(await latestStrategyAnchor(rpc),rpc,web);
  const balances=await sources.balances(account);if(!balances)return null;
  let total=0n;
  for(const b of balances){const raw=BigInt(b.raw);if(raw===0n)continue;const bound=await sources.priceBound(b.symbol);if(!bound)return null;total+=raw*BigInt(bound.lowerMicroUsd)/10n**BigInt(b.decimals);}
  return total;
 }catch{return null;}
}
