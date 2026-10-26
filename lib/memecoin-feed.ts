import {claimMemecoinRefresh,readMemecoinCache,saveMemecoinCache} from '../db/memecoin-cache.ts';
import {MEMECOINS} from './memecoin-list.ts';
import {readMemecoinMarket,change24h,type MemecoinRow,type MemecoinPoint} from './memecoin-market.ts';

const FRESH_MS=10*60_000,KEEP_FULL_MS=6*3600_000;
export const MEMECOIN_REFRESH_GAP_MS=2*60_000;

// Calls the price APIs at most once per gap across every page view and
// background check. A full copy less than 10 minutes old is left alone.
export async function refreshMemecoinMarket(db:D1Database,fetcher:typeof fetch=fetch,now=new Date(),gapMs=MEMECOIN_REFRESH_GAP_MS){
 const cached=await readMemecoinCache(db);
 // A copy saved before a coin was added to the list is not fresh for that coin.
 const coversList=!!cached.full&&MEMECOINS.every(c=>cached.full!.rows.some(r=>r.contract===c.contract));
 if(cached.full&&coversList&&now.getTime()-Date.parse(cached.full.updatedAt)<FRESH_MS)return {skipped:'fresh'};
 if(cached.attemptedAt&&now.getTime()-Date.parse(cached.attemptedAt)<gapMs)return {skipped:'recent'};
 if(!await claimMemecoinRefresh(db,cached.attemptedAt,now))return {skipped:'busy'};
 try{const r=await readMemecoinMarket(fetcher);await saveMemecoinCache(db,r.rows,r.complete,new Date());return {saved:r.complete?'full':'partial'};}
 catch(e){return {failed:e instanceof Error?e.message.slice(0,160):'failed'};}
}

// Hourly candles from GeckoTerminal (when it answered) followed by Steward's
// own 5-minute pool prices, so the line never has two sources at once.
export function mergePoints(candles:MemecoinPoint[],own:MemecoinPoint[]):MemecoinPoint[]{
 const first=own[0]?.t??Infinity;
 return [...candles.filter(p=>p.t<first),...own].sort((a,b)=>a.t-b.t);
}

export type MemecoinView={coins:(MemecoinRow&{livePrice:boolean})[];updatedAt:string|null;complete:boolean;source:string};
type Deps={liveMid:(symbol:string)=>Promise<number|null>;history?:(symbol:string)=>Promise<MemecoinPoint[]>};

// What Markets shows: the best saved copy, Steward's own price history, and
// each tradable coin's price from a live on-chain quote in the pool it trades.
export async function memecoinMarketView(db:D1Database,deps:Deps,now=new Date()):Promise<MemecoinView>{
 const cached=await readMemecoinCache(db).catch(()=>({full:null,partial:null,attemptedAt:null}));
 const full=cached.full&&now.getTime()-Date.parse(cached.full.updatedAt)<=KEEP_FULL_MS?cached.full:null;
 const usable=full??[cached.partial,cached.full].filter(x=>!!x).sort((a,b)=>Date.parse(b!.updatedAt)-Date.parse(a!.updatedAt))[0]??null;
 const coins=await Promise.all(MEMECOINS.map(async coin=>{
  const saved=usable?.rows.find(r=>r.contract===coin.contract);
  const base:MemecoinRow=saved??{symbol:coin.symbol,name:coin.name,contract:coin.contract,tradable:coin.tradable,note:coin.note,priceUsd:null,change24hPct:null,liquidityUsd:null,volume24hUsd:null,marketCapUsd:null,points:[]};
  const own=deps.history?await deps.history(coin.symbol).catch(()=>[]):[];
  const points=mergePoints(base.points,own);
  const live=await deps.liveMid(coin.symbol).catch(()=>null);
  // Without a live quote, Steward's own newest pool price wins when it is newer than the saved copy.
  const ownLast=own.at(-1),ownNewer=!!ownLast&&(!usable||ownLast.t>Date.parse(usable.updatedAt));
  return {...base,tradable:coin.tradable,note:coin.note,points,change24hPct:change24h(points)??base.change24hPct,priceUsd:live??(ownNewer?ownLast!.c:base.priceUsd??points.at(-1)?.c??null),livePrice:live!==null};
 }));
 return {coins,updatedAt:usable?.updatedAt??null,complete:!!usable?.complete,source:usable?.complete?'GeckoTerminal':usable?'DexScreener (backup)':'none'};
}
