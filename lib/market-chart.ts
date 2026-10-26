import {fetchPracticeMarketQuote} from './practice-market.ts';
import {stockCatalog,type StockCatalogItem} from './stock-catalog.ts';

export const FEATURED_MARKETS=['AAPL','MSFT','NVDA','META','AMZN','GOOGL','TSLA','AMD','JPM','KO','DIS','NFLX'] as const;
export type MarketSample={symbol:string;observedAt:string;bidCents:number;askCents:number};
type SampleRow={symbol:string;observed_at:string;bid_cents:number;ask_cents:number};

export async function fetchMarketCatalog(fetcher:typeof fetch=fetch):Promise<StockCatalogItem[]>{
 const response=await fetcher('https://api.robinhood.com/rhj/assets',{cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('The market list is unavailable.');
 return stockCatalog(await response.json());
}

export async function sampleMarket(db:D1Database,symbol:string,now=Date.now(),fetcher:typeof fetch=fetch):Promise<MarketSample|null>{
 const quote=await fetchPracticeMarketQuote(symbol,now,fetcher);
 if(!quote||!quote.bidCents||!quote.askCents)return null;
 const sample={symbol,observedAt:new Date(quote.generatedAt).toISOString(),bidCents:quote.bidCents,askCents:quote.askCents};
 await db.prepare('INSERT OR IGNORE INTO market_price_samples(symbol,observed_at,bid_cents,ask_cents) VALUES(?,?,?,?)').bind(sample.symbol,sample.observedAt,sample.bidCents,sample.askCents).run();
 return sample;
}

export async function marketHistory(db:D1Database,symbol:string,days=30):Promise<MarketSample[]>{
 const cutoff=new Date(Date.now()-Math.min(30,Math.max(1,days))*86400000).toISOString();
 const rows=(await db.prepare('SELECT symbol,observed_at,bid_cents,ask_cents FROM market_price_samples WHERE symbol=? AND observed_at>=? ORDER BY observed_at ASC LIMIT 4000').bind(symbol,cutoff).all<SampleRow>()).results??[];
 return rows.map(row=>({symbol:row.symbol,observedAt:row.observed_at,bidCents:row.bid_cents,askCents:row.ask_cents}));
}

export async function latestMarketSamples(db:D1Database,symbols:string[]):Promise<Record<string,MarketSample>>{
 if(!symbols.length)return {};
 const placeholders=symbols.map(()=>'?').join(',');
 const rows=(await db.prepare(`SELECT symbol,observed_at,bid_cents,ask_cents FROM market_price_samples p WHERE p.symbol IN (${placeholders}) AND p.observed_at=(SELECT MAX(observed_at) FROM market_price_samples WHERE symbol=p.symbol)`).bind(...symbols).all<SampleRow>()).results??[];
 return Object.fromEntries(rows.map(row=>[row.symbol,{symbol:row.symbol,observedAt:row.observed_at,bidCents:row.bid_cents,askCents:row.ask_cents}]));
}

export async function sampleScheduledMarkets(db:D1Database,now=Date.now(),fetcher:typeof fetch=fetch){
 const catalog=await fetchMarketCatalog(fetcher);
 const supported=new Set(catalog.map(stock=>stock.symbol));
 const recent=(await db.prepare('SELECT DISTINCT symbol FROM market_price_samples WHERE observed_at>=? ORDER BY symbol LIMIT 50').bind(new Date(now-7*86400000).toISOString()).all<{symbol:string}>()).results??[];
 const ruled=(await db.prepare("SELECT DISTINCT json_extract(rule_json,'$.symbol') AS symbol FROM autonomous_shadow_plans WHERE enabled=1 LIMIT 50").all<{symbol:string}>().catch(()=>({results:[]}))).results??[];
 const agents=(await db.prepare("SELECT settings_json FROM ai_agents WHERE enabled=1 LIMIT 50").all<{settings_json:string}>().catch(()=>({results:[]}))).results??[];
 const agentSymbols=agents.flatMap(row=>{try{return (JSON.parse(row.settings_json) as {symbols:string[]}).symbols;}catch{return [];}});
 const symbols=[...new Set([...FEATURED_MARKETS,...ruled.map(row=>row.symbol),...agentSymbols,...recent.map(row=>row.symbol)])].filter(symbol=>supported.has(symbol));
 let recorded=0;
 for(let i=0;i<symbols.length;i+=8){
  const results=await Promise.allSettled(symbols.slice(i,i+8).map(symbol=>sampleMarket(db,symbol,now,fetcher)));
  recorded+=results.filter(result=>result.status==='fulfilled'&&result.value!==null).length;
 }
 await db.prepare('DELETE FROM market_price_samples WHERE observed_at<?').bind(new Date(now-30*86400000).toISOString()).run();
 return {tracked:symbols.length,recorded};
}

// Every-minute sampling for stocks with an active fast rule (stop-loss,
// take profit, trailing stop) so the trailing high and stop checks are current.
export async function sampleFastRuleMarkets(db:D1Database,now=Date.now(),fetcher:typeof fetch=fetch){
 const rows=(await db.prepare("SELECT DISTINCT json_extract(rule_json,'$.symbol') AS symbol FROM autonomous_shadow_plans WHERE enabled=1 AND json_extract(rule_json,'$.intervalMinutes')<15 LIMIT 20").all<{symbol:string}>()).results??[];
 const results=await Promise.allSettled(rows.map(row=>sampleMarket(db,row.symbol,now,fetcher)));
 return {tracked:rows.length,recorded:results.filter(r=>r.status==='fulfilled'&&r.value!==null).length};
}
