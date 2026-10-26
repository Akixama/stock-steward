import {env} from 'cloudflare:workers';
import {MEMECOIN_MAX_ORDER_CENTS} from '@/lib/memecoin-list';
import {memecoinMarketView,refreshMemecoinMarket} from '@/lib/memecoin-feed';
import {memecoinQuote,rpcEthCall} from '@/lib/memecoin-price';
import {chainTransport} from '@/lib/chain-transport';

// Pages read the copy saved in the database (refreshed by the background check
// and, at most every 2 minutes, by a page view). Price APIs throttle Cloudflare's
// shared servers, so nothing here depends on them answering right now.
// Tradable coins also get a live price from their own pool, cached for a minute.
const live=new Map<string,{mid:number|null;at:number}>();
async function liveMid(symbol:string){
 const hit=live.get(symbol);if(hit&&Date.now()-hit.at<60_000)return hit.mid;
 const q=await memecoinQuote(symbol,rpcEthCall(chainTransport(env.ALCHEMY_API_KEY)));
 const mid=q?Number(q.bidMicro+q.askMicro)/2/1_000_000:null;live.set(symbol,{mid,at:Date.now()});return mid;
}

export async function GET(){
 if(!env.DB)return Response.json({error:'Memecoin prices are unavailable right now.'},{status:503,headers:{'Cache-Control':'no-store'}});
 try{await refreshMemecoinMarket(env.DB);}catch{/* The saved copy below still serves. */}
 const view=await memecoinMarketView(env.DB,liveMid);
 if(view.coins.every(c=>c.priceUsd===null))return Response.json({error:'Memecoin prices are unavailable right now.'},{status:503,headers:{'Cache-Control':'no-store'}});
 return Response.json({...view,maxBuyCents:MEMECOIN_MAX_ORDER_CENTS},{headers:{'Cache-Control':'public, max-age=60'}});
}
