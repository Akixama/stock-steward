import {env} from 'cloudflare:workers';
import {FEATURED_MARKETS,fetchMarketCatalog,latestMarketSamples,marketHistory,sampleMarket} from '@/lib/market-chart';
import type {StockCatalogItem} from '@/lib/stock-catalog';

let catalogCache:{value:StockCatalogItem[];expiresAt:number}|null=null;
let catalogLoading:Promise<StockCatalogItem[]>|null=null;
function chartCatalog(){
 if(catalogCache&&Date.now()<catalogCache.expiresAt)return Promise.resolve(catalogCache.value);
 if(!catalogLoading)catalogLoading=fetchMarketCatalog().then(value=>{catalogCache={value,expiresAt:Date.now()+5*60_000};return value;}).catch(error=>{if(catalogCache)return catalogCache.value;throw error;}).finally(()=>{catalogLoading=null;});
 return catalogLoading;
}

export async function GET(request:Request){
 const db=env.DB;
 if(!db)return Response.json({error:'Market history is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});
 try{
  const params=new URL(request.url).searchParams;
  const requested=params.get('symbol')?.toUpperCase()??'AAPL';
  if(!/^[A-Z][A-Z0-9.]{0,7}$/.test(requested))return Response.json({error:'Choose a valid stock.'},{status:400});
  const symbols=[...new Set([requested,...FEATURED_MARKETS])];
  const [catalog,history,quotes]=await Promise.all([
   chartCatalog(),
   marketHistory(db,requested),
   latestMarketSamples(db,symbols),
  ]);
  const selected=catalog.find(stock=>stock.symbol===requested);
  if(!selected)return Response.json({error:'That stock is not in the current Robinhood Chain catalog.'},{status:404});
  const supported=new Set(catalog.map(stock=>stock.symbol));
  for(const symbol of Object.keys(quotes))if(!supported.has(symbol))delete quotes[symbol];
  // Return saved prices promptly. The page asks for a fresh selected price in
  // a second, non-blocking request; the scheduled job fills the featured strip.
  if(params.get('refresh')==='1'&&(!quotes[requested]||Date.now()-Date.parse(quotes[requested].observedAt)>60000)){
   const observed=await sampleMarket(db,requested);
   if(observed){quotes[requested]=observed;if(history.at(-1)?.observedAt!==observed.observedAt)history.push(observed);}
  }
  return Response.json({catalog,selected,quotes,history,source:'Robinhood Stock Token API · underlying equity bid/ask',sampledAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
 }catch{
  return Response.json({error:'Market data is temporarily unavailable. Try again shortly.'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}
