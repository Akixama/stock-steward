import type {LiveAsset} from '../lib/live-strategy.ts';
export async function liveStrategyHistory(db:D1Database,owner:string,address:string){
 const rows=await db.prepare("SELECT state,updated_at,plan_json FROM execution_attempts WHERE owner_ref=? AND address=? AND state NOT IN ('released','reverted') LIMIT 501").bind(owner,address.toLowerCase()).all<{state:string;updated_at:string;plan_json:string}>();
 if(rows.results.length>500)throw Error('Trade history exceeds verification capacity.');
 let lastFillAt:string|null=null;const usedNews=new Set<string>();
 for(const row of rows.results){const at=Date.parse(row.updated_at);if(!Number.isFinite(at))throw Error('Invalid trade timestamp');if(row.state==='confirmed'&&(!lastFillAt||at>Date.parse(lastFillAt)))lastFillAt=row.updated_at;const plan=JSON.parse(row.plan_json);if(plan.newsEventId)usedNews.add(plan.newsEventId);}
 return {lastFillAt,usedNews};
}
export async function observeStrategyPrices(db:D1Database,owner:string,address:string,assets:LiveAsset[],blockHash:string,intervalHours:number,now=Date.now()){
 for(const asset of assets){if(!asset.shareUpperMicroUsd)continue;
  const previous=await db.prepare('SELECT price_at,share_upper_micro_usd FROM autonomous_strategy_prices WHERE owner_ref=? AND address=? AND symbol=? AND price_at<=? ORDER BY price_at DESC LIMIT 1').bind(owner,address.toLowerCase(),asset.symbol,new Date(now-intervalHours*3600000).toISOString()).first<{price_at:string;share_upper_micro_usd:string}>();
  if(previous){asset.previousAt=previous.price_at;asset.previousUpperMicroUsd=previous.share_upper_micro_usd;}
  await db.prepare('INSERT INTO autonomous_strategy_prices(owner_ref,address,symbol,observation_slot,block_hash,price_at,share_upper_micro_usd) VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_ref,address,symbol,observation_slot) DO NOTHING').bind(owner,address.toLowerCase(),asset.symbol,String(Math.floor(Date.parse(asset.priceAt)/900000)),blockHash,asset.priceAt,asset.shareUpperMicroUsd).run();
 }
 await db.prepare('DELETE FROM autonomous_strategy_prices WHERE owner_ref=? AND address=? AND price_at<?').bind(owner,address.toLowerCase(),new Date(now-2*366*86400000).toISOString()).run();
}
