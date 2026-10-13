import {registry} from './robinhood-chain.ts';
import {priceEvidence,parseUsdCents} from './chain-analysis.ts';
import type {AutonomousSignal} from './autonomous-live.ts';
// Official quotes are strategy signals only. Executable pool quotes and complete
// account/fee evidence are separate requirements before a session may sign.
export async function readAutonomousSignal(symbol:string,fetcher:typeof fetch=fetch):Promise<AutonomousSignal|null>{
 try{
  const response=await fetcher('https://api.robinhood.com/rhj/assets',{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!response.ok)return null;
  const asset=registry(await response.json()).find(t=>t.symbol===symbol);
  if(!asset)return null;
  const quote=await fetcher(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(symbol)}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(!quote.ok)return null;
  const price=priceEvidence({...asset,raw:'0',decimals:18,quantity:'0'},await quote.json());
  const ask=price.ask?parseUsdCents(price.ask):null;
  if(price.state!=='fresh'||ask===null||!price.generatedAt)return null;
  return {chainId:4663,symbol,askCents:ask,observedAt:price.generatedAt,halted:false,source:'Robinhood official price API'};
 }catch{return null;}
}
