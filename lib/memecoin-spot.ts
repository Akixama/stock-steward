import {encodeFunctionData,decodeFunctionResult,parseAbi,type Hex} from 'viem';
import {VENUE} from './chain-route.ts';
import {MEMECOINS,type Memecoin} from './memecoin-list.ts';
import type {EthCall} from './memecoin-price.ts';

// Spot price from a pool's current state, for the Markets chart only. It is
// the pool's mid price, not what a trade would get, and it never sizes an order.
const stateAbi=parseAbi(['function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)']);
const Q192=2n**192n;
export const SAMPLE_SLOT_MS=5*60_000;

// Micro-USD per whole coin. quoteUsdMicro is the price of the pool's other side
// (1,000,000 for USDG, the ETH price for ETH).
export function spotMicro(sqrtPriceX96:bigint,spot:Memecoin['spot'],quoteUsdMicro:bigint):bigint|null{
 if(sqrtPriceX96<=0n||quoteUsdMicro<=0n)return null;
 const sq=sqrtPriceX96*sqrtPriceX96,coin=10n**BigInt(spot.coinDecimals),quote=10n**BigInt(spot.quoteDecimals);
 // Pool price is currency1 per currency0, in raw units.
 const micro=spot.coinIs===0?sq*coin*quoteUsdMicro/(Q192*quote):Q192*coin*quoteUsdMicro/(sq*quote);
 return micro>0n?micro:null;
}

export async function readSpotMicro(coin:Memecoin,call:EthCall,quoteUsdMicro:{USDG:bigint;ETH:bigint|null}):Promise<bigint|null>{
 const usd=coin.spot.quote==='USDG'?quoteUsdMicro.USDG:quoteUsdMicro.ETH;if(!usd)return null;
 try{
  const raw=await call(VENUE.state,encodeFunctionData({abi:stateAbi,functionName:'getSlot0',args:[coin.spot.poolId as Hex]}));
  if(typeof raw!=='string'||!/^0x[0-9a-f]+$/i.test(raw))return null;
  const [sqrt]=decodeFunctionResult({abi:stateAbi,functionName:'getSlot0',data:raw as Hex}) as readonly [bigint,number,number,number];
  return spotMicro(sqrt,coin.spot,usd);
 }catch{return null;}
}

export async function ethUsdMicro(web:typeof fetch):Promise<bigint|null>{
 try{
  const r=await web('https://api.exchange.coinbase.com/products/ETH-USD/ticker',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)return null;
  const price=Number((await r.json() as {price?:string}).price);
  return Number.isFinite(price)&&price>0?BigInt(Math.round(price*1e6)):null;
 }catch{return null;}
}

export const slotOf=(at:number)=>new Date(Math.floor(at/SAMPLE_SLOT_MS)*SAMPLE_SLOT_MS).toISOString();

// Saves one price per coin per 5-minute slot. Slots already saved cost no reads.
export async function sampleMemecoins(db:D1Database,call:EthCall,web:typeof fetch,now=Date.now(),coins:readonly Memecoin[]=MEMECOINS){
 const bucket=slotOf(now);
 const have=new Set(((await db.prepare('SELECT symbol FROM memecoin_price_samples WHERE bucket=?').bind(bucket).all<{symbol:string}>()).results??[]).map(r=>r.symbol));
 const due=coins.filter(c=>!have.has(c.symbol));if(!due.length)return {saved:0,skipped:coins.length};
 const eth=due.some(c=>c.spot.quote==='ETH')?await ethUsdMicro(web):null;
 let saved=0;
 for(const coin of due){
  const micro=await readSpotMicro(coin,call,{USDG:1_000_000n,ETH:eth});
  if(micro===null||micro>BigInt(Number.MAX_SAFE_INTEGER))continue;
  const r=await db.prepare('INSERT OR IGNORE INTO memecoin_price_samples(symbol,bucket,price_micro) VALUES(?,?,?)').bind(coin.symbol,bucket,Number(micro)).run();
  saved+=r.meta.changes;
 }
 return {saved,skipped:coins.length-due.length};
}

export async function memecoinHistory(db:D1Database,symbol:string,now=Date.now(),days=7){
 const rows=(await db.prepare('SELECT bucket,price_micro FROM memecoin_price_samples WHERE symbol=? AND bucket>=? ORDER BY bucket LIMIT 2100').bind(symbol,new Date(now-days*86400_000).toISOString()).all<{bucket:string;price_micro:number}>()).results??[];
 return rows.map(r=>({t:Date.parse(r.bucket),c:r.price_micro/1_000_000}));
}
