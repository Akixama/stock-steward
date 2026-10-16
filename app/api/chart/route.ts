import {env} from 'cloudflare:workers';
import {FEATURED_MARKETS,fetchMarketCatalog,latestMarketSamples,marketHistory,sampleMarket} from '@/lib/market-chart';

export async function GET(request:Request){
 const db=env.DB;
 if(!db)return Response.json({error:'Market history is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});
 try{
  const requested=new URL(request.url).searchParams.get('symbol')?.toUpperCase()??'AAPL';
  if(!/^[A-Z][A-Z0-9.]{0,7}$/.test(requested))return Response.json({error:'Choose a valid stock.'},{status:400});
  const symbols=[...new Set([requested,...FEATURED_MARKETS])];
  const [catalog,history,quotes]=await Promise.all([
   fetchMarketCatalog(),
   marketHistory(db,requested),
   latestMarketSamples(db,symbols),
  ]);
  const selected=catalog.find(stock=>stock.symbol===requested);
  if(!selected)return Response.json({error:'That stock is not in the current Robinhood Chain catalog.'},{status:404});
  const supported=new Set(catalog.map(stock=>stock.symbol));
  for(const symbol of Object.keys(quotes))if(!supported.has(symbol))delete quotes[symbol];
  // The scheduled market check fills the featured strip. A page visit only
  // refreshes its selected stock, so navigation never waits on 12 quote calls.
  if(!quotes[requested]||Date.now()-Date.parse(quotes[requested].observedAt)>60000){
   const observed=await sampleMarket(db,requested);
   if(observed){quotes[requested]=observed;if(history.at(-1)?.observedAt!==observed.observedAt)history.push(observed);}
  }
  return Response.json({catalog,selected,quotes,history,source:'Robinhood Stock Token API · underlying equity bid/ask',sampledAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
 }catch{
  return Response.json({error:'Market data is temporarily unavailable. Try again shortly.'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}
