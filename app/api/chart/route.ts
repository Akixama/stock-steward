import {env} from 'cloudflare:workers';
import {FEATURED_MARKETS,fetchMarketCatalog,latestMarketSamples,marketHistory,sampleMarket} from '@/lib/market-chart';

export async function GET(request:Request){
 const db=env.DB;
 if(!db)return Response.json({error:'Market history is temporarily unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});
 try{
  const catalog=await fetchMarketCatalog();
  const requested=new URL(request.url).searchParams.get('symbol')?.toUpperCase()??'AAPL';
  if(!/^[A-Z][A-Z0-9.]{0,7}$/.test(requested))return Response.json({error:'Choose a valid stock.'},{status:400});
  const selected=catalog.find(stock=>stock.symbol===requested);
  if(!selected)return Response.json({error:'That stock is not in the current Robinhood Chain catalog.'},{status:404});
  const supported=new Set(catalog.map(stock=>stock.symbol));
  const symbols=[...new Set([selected.symbol,...FEATURED_MARKETS])].filter(symbol=>supported.has(symbol));
  const quotes:Record<string,Awaited<ReturnType<typeof sampleMarket>>>=await latestMarketSamples(db,symbols);
  const toFetch=symbols.filter(symbol=>!quotes[symbol]||symbol===selected.symbol&&Date.now()-Date.parse(quotes[symbol]!.observedAt)>60000);
  const observed=await Promise.allSettled(toFetch.map(symbol=>sampleMarket(db,symbol)));
  observed.forEach((result,index)=>{if(result.status==='fulfilled'&&result.value)quotes[toFetch[index]]=result.value;});
  const history=await marketHistory(db,selected.symbol);
  return Response.json({catalog,selected,quotes,history,source:'Robinhood Stock Token API · underlying equity bid/ask',sampledAt:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
 }catch{
  return Response.json({error:'Market data is temporarily unavailable. Try again shortly.'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}
