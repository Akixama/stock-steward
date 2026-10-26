import {MEMECOINS,type Memecoin} from './memecoin-list.ts';

// Markets view of the hand-checked memecoins. Display only: prices, liquidity
// and a 7-day hourly line come from GeckoTerminal's public API, with DexScreener
// as a backup for price and 24h change. Trades never use these numbers; a buy is
// quoted on chain when it is reviewed.
export type MemecoinPoint={t:number;c:number};
export type MemecoinRow={symbol:string;name:string;contract:string;tradable:boolean;note:string;priceUsd:number|null;change24hPct:number|null;liquidityUsd:number|null;volume24hUsd:number|null;marketCapUsd:number|null;points:MemecoinPoint[]};
type TokenStats={priceUsd:number|null;liquidityUsd:number|null;volume24hUsd:number|null;marketCapUsd:number|null};
type DexStats={priceUsd:number|null;change24hPct:number|null};
const API='https://api.geckoterminal.com/api/v2/networks/robinhood';
const num=(v:unknown)=>{const n=typeof v==='string'||typeof v==='number'?Number(v):NaN;return Number.isFinite(n)&&n>=0?n:null;};

export function parseTokens(body:unknown):Map<string,TokenStats>{
 const out=new Map<string,TokenStats>();
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

// DexScreener backs up price and 24h change only. Its per-pair liquidity can
// count hooked pools at face value, so liquidity always comes from GeckoTerminal.
export function parseDexPairs(body:unknown):Map<string,DexStats>{
 const out=new Map<string,DexStats>();
 for(const p of Array.isArray(body)?body:[]){
  const pair=p as {chainId?:unknown;baseToken?:{address?:unknown};priceUsd?:unknown;priceChange?:{h24?:unknown}};
  if(pair.chainId!=='robinhood'||typeof pair.baseToken?.address!=='string')continue;
  const key=pair.baseToken.address.toLowerCase();if(out.has(key))continue;
  const change=Number(pair.priceChange?.h24);
  out.set(key,{priceUsd:num(pair.priceUsd),change24hPct:Number.isFinite(change)?change:null});
 }
 return out;
}

export async function readMemecoinMarket(fetcher:typeof fetch=fetch,coins:readonly Memecoin[]=MEMECOINS,pause=(ms:number)=>new Promise(r=>setTimeout(r,ms))):Promise<{rows:MemecoinRow[];complete:boolean}>{
 // GeckoTerminal's free limit is shared by everyone calling from the same
 // servers, so a busy answer (429) gets one retry before falling back.
 const get=async(url:string,label:string)=>{
  for(let attempt=0;;attempt++){
   const r=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
   if(r.ok)return r.json();
   if(r.status!==429||attempt>0)throw Error(label+' '+r.status);
   await pause(1500);
  }
 };
 const ids=coins.map(c=>c.contract).join(',');
 let tokens=new Map<string,TokenStats>(),complete=true;const problems:string[]=[];const note=(e:unknown)=>{problems.push(e instanceof Error?e.message.slice(0,60):'failed');};
 try{tokens=parseTokens(await get(API+'/tokens/multi/'+ids,'GeckoTerminal'));}catch(e){complete=false;note(e);}
 let dex=new Map<string,DexStats>();
 if(!complete)try{dex=parseDexPairs(await get('https://api.dexscreener.com/tokens/v1/robinhood/'+ids,'DexScreener'));}catch(e){note(e);/* Both sources down: the caller keeps its last copy. */}
 const rows:MemecoinRow[]=[];
 for(const coin of coins){
  let points:MemecoinPoint[]=[];
  if(complete)try{points=parseCandles(await get(API+'/pools/'+coin.chartPool+'/ohlcv/hour?aggregate=1&limit=168&currency=usd','GeckoTerminal'));}catch{points=[];complete=false;}
  const t=tokens.get(coin.contract),d=dex.get(coin.contract);
  rows.push({symbol:coin.symbol,name:coin.name,contract:coin.contract,tradable:coin.tradable,note:coin.note,
   priceUsd:t?.priceUsd??points.at(-1)?.c??d?.priceUsd??null,change24hPct:change24h(points)??d?.change24hPct??null,
   liquidityUsd:t?.liquidityUsd??null,volume24hUsd:t?.volume24hUsd??null,marketCapUsd:t?.marketCapUsd??null,points});
 }
 if(rows.every(r=>r.priceUsd===null))throw Error('Memecoin prices unavailable: '+problems.join('; '));
 return {rows,complete};
}
