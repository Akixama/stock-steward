import {claimMemecoinRefresh,readMemecoinCache,saveMemecoinCache} from '../db/memecoin-cache.ts';
import {MEMECOINS} from './memecoin-list.ts';
import {readMemecoinMarket,type MemecoinRow} from './memecoin-market.ts';

const FRESH_MS=10*60_000,KEEP_FULL_MS=6*3600_000;
export const MEMECOIN_REFRESH_GAP_MS=2*60_000;

// Calls the price APIs at most once per gap across every page view and
// background check. A full copy less than 10 minutes old is left alone.
export async function refreshMemecoinMarket(db:D1Database,fetcher:typeof fetch=fetch,now=new Date(),gapMs=MEMECOIN_REFRESH_GAP_MS){
 const cached=await readMemecoinCache(db);
 if(cached.full&&now.getTime()-Date.parse(cached.full.updatedAt)<FRESH_MS)return {skipped:'fresh'};
 if(cached.attemptedAt&&now.getTime()-Date.parse(cached.attemptedAt)<gapMs)return {skipped:'recent'};
 if(!await claimMemecoinRefresh(db,cached.attemptedAt,now))return {skipped:'busy'};
 try{const r=await readMemecoinMarket(fetcher);await saveMemecoinCache(db,r.rows,r.complete,new Date());return {saved:r.complete?'full':'partial'};}
 catch(e){return {failed:e instanceof Error?e.message.slice(0,160):'failed'};}
}

export type MemecoinView={coins:(MemecoinRow&{livePrice:boolean})[];updatedAt:string|null;complete:boolean;source:string};

// What Markets shows: the best saved copy, with each tradable coin's price
// replaced by a live on-chain quote from the pool Steward trades.
export async function memecoinMarketView(db:D1Database,liveMid:(symbol:string)=>Promise<number|null>,now=new Date()):Promise<MemecoinView>{
 const cached=await readMemecoinCache(db).catch(()=>({full:null,partial:null,attemptedAt:null}));
 const full=cached.full&&now.getTime()-Date.parse(cached.full.updatedAt)<=KEEP_FULL_MS?cached.full:null;
 const usable=full??[cached.partial,cached.full].filter(x=>!!x).sort((a,b)=>Date.parse(b!.updatedAt)-Date.parse(a!.updatedAt))[0]??null;
 const coins=await Promise.all(MEMECOINS.map(async coin=>{
  const saved=usable?.rows.find(r=>r.contract===coin.contract);
  const base:MemecoinRow=saved??{symbol:coin.symbol,name:coin.name,contract:coin.contract,tradable:coin.tradable,note:coin.note,priceUsd:null,change24hPct:null,liquidityUsd:null,volume24hUsd:null,marketCapUsd:null,points:[]};
  const live=coin.tradable?await liveMid(coin.symbol).catch(()=>null):null;
  return {...base,tradable:coin.tradable,note:coin.note,priceUsd:live??base.priceUsd,livePrice:live!==null};
 }));
 return {coins,updatedAt:usable?.updatedAt??null,complete:!!usable?.complete,source:usable?.complete?'GeckoTerminal':usable?'DexScreener (backup)':'none'};
}
