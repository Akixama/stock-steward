import {MEMECOINS,type Memecoin} from './memecoin-list.ts';

// Markets view of the hand-checked memecoins. Display only: prices, liquidity
// and a 7-day hourly line come from GeckoTerminal's public API. Trades never use
// these numbers; a buy is quoted on chain when it is reviewed.
export type MemecoinPoint={t:number;c:number};
export type MemecoinRow={symbol:string;name:string;contract:string;tradable:boolean;note:string;priceUsd:number|null;change24hPct:number|null;liquidityUsd:number|null;volume24hUsd:number|null;marketCapUsd:number|null;points:MemecoinPoint[]};
const API='https://api.geckoterminal.com/api/v2/networks/robinhood';
const num=(v:unknown)=>{const n=typeof v==='string'||typeof v==='number'?Number(v):NaN;return Number.isFinite(n)&&n>=0?n:null;};

export function parseTokens(body:unknown):Map<string,{priceUsd:number|null;liquidityUsd:number|null;volume24hUsd:number|null;marketCapUsd:number|null}>{
 const out=new Map();
 for(const row of (body as {data?:unknown[]})?.data??[]){
  const a=(row as {attributes?:Record<string,unknown>})?.attributes;if(!a||typeof a.address!=='string')continue;
  out.set(a.address.toLowerCase(),{priceUsd:num(a.price_usd),liquidityUsd:num(a.total_reserve_in_usd),volume24hUsd:num((a.volume_usd as {h24?:unknown})?.h24),marketCapUsd:num(a.market_cap_usd)??num(a.fdv_usd)});
 }
 return out;
}

// GeckoTerminal lists candles newest first: [time, open, high, low, close, volume].
export function parseCandles(body:unknown):MemecoinPoint[]{
 const list=(body as {data?:{attributes?:{ohlcv_list?:unknown[]}}})?.data?.attributes?.ohlcv_list;
 if(!Array.isArray(list))return [];
 return list.flatMap(c=>{if(!Array.isArray(c))return [];const t=Number(c[0]),close=Number(c[4]);return Number.isFinite(t)&&Number.isFinite(close)&&close>0?[{t:t*1000,c:close}]:[];}).sort((a,b)=>a.t-b.t);
}

export function change24h(points:MemecoinPoint[]):number|null{
 const last=points.at(-1);if(!last)return null;
 const base=[...points].reverse().find(p=>last.t-p.t>=23.5*3600_000);
 return base?(last.c-base.c)/base.c*100:null;
}

export async function readMemecoinMarket(fetcher:typeof fetch=fetch,coins:readonly Memecoin[]=MEMECOINS):Promise<MemecoinRow[]>{
 const get=async(url:string)=>{const r=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error(`GeckoTerminal ${r.status}`);return r.json();};
 const tokens=parseTokens(await get(`${API}/tokens/multi/${coins.map(c=>c.contract).join(',')}`));
 const rows:MemecoinRow[]=[];
 for(const coin of coins){
  let points:MemecoinPoint[]=[];
  try{points=parseCandles(await get(`${API}/pools/${coin.chartPool}/ohlcv/hour?aggregate=1&limit=168&currency=usd`));}catch{points=[];}
  const t=tokens.get(coin.contract);
  rows.push({symbol:coin.symbol,name:coin.name,contract:coin.contract,tradable:coin.tradable,note:coin.note,priceUsd:t?.priceUsd??points.at(-1)?.c??null,change24hPct:change24h(points),liquidityUsd:t?.liquidityUsd??null,volume24hUsd:t?.volume24hUsd??null,marketCapUsd:t?.marketCapUsd??null,points});
 }
 return rows;
}
