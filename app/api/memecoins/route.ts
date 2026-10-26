import {env} from 'cloudflare:workers';
import {MEMECOIN_MAX_ORDER_CENTS,memecoin} from '@/lib/memecoin-list';
import {memecoinMarketView,refreshMemecoinMarket} from '@/lib/memecoin-feed';
import {memecoinQuote,rpcEthCall} from '@/lib/memecoin-price';
import {ethUsdMicro,memecoinHistory,readSpotMicro} from '@/lib/memecoin-spot';
import {chainTransport} from '@/lib/chain-transport';

// Pages read the copy saved in the database (refreshed by the background check
// and, at most every 2 minutes, by a page view). Price APIs throttle Cloudflare's
// shared servers, so nothing here depends on them answering right now. The chart
// line is Steward's own pool prices, saved every 5 minutes by the background check.
// Every coin also gets a live price from its own pool, cached for a minute: the
// tradable one from a $100 buy/sell quote, watch-only ones from the pool's mid price.
const live=new Map<string,{mid:number|null;at:number}>();
let eth:{micro:bigint|null;at:number}|null=null;
async function liveMid(symbol:string){
 const hit=live.get(symbol);if(hit&&Date.now()-hit.at<60_000)return hit.mid;
 const coin=memecoin(symbol);if(!coin)return null;
 const call=rpcEthCall(chainTransport(env.ALCHEMY_API_KEY));
 let mid:number|null=null;
 if(coin.tradable){const q=await memecoinQuote(symbol,call);mid=q?Number(q.bidMicro+q.askMicro)/2/1_000_000:null;}
 else{
  if(coin.spot.quote==='ETH'&&(!eth||Date.now()-eth.at>60_000))eth={micro:await ethUsdMicro(fetch),at:Date.now()};
  const micro=await readSpotMicro(coin,call,{USDG:1_000_000n,ETH:eth?.micro??null});mid=micro===null?null:micro/1_000_000;
 }
 live.set(symbol,{mid,at:Date.now()});return mid;
}

export async function GET(){
 const db=env.DB;
 if(!db)return Response.json({error:'Memecoin prices are unavailable right now.'},{status:503,headers:{'Cache-Control':'no-store'}});
 try{await refreshMemecoinMarket(db);}catch{/* The saved copy below still serves. */}
 const view=await memecoinMarketView(db,{liveMid,history:symbol=>memecoinHistory(db,symbol)});
 if(view.coins.every(c=>c.priceUsd===null))return Response.json({error:'Memecoin prices are unavailable right now.'},{status:503,headers:{'Cache-Control':'no-store'}});
 return Response.json({...view,maxBuyCents:MEMECOIN_MAX_ORDER_CENTS},{headers:{'Cache-Control':'public, max-age=60'}});
}
