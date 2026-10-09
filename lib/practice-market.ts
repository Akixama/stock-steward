export type PracticeMarketQuote = {symbol:string;priceCents:number;bidCents?:number;askCents?:number;generatedAt:number;source:'Robinhood underlying-equity ask'};

// Practice uses the underlying stock ask as an indicative buy price. It is not a token swap quote.
export function parsePracticeMarketQuote(body:unknown,symbol:string,now=Date.now()):PracticeMarketQuote|null {
  try {
    const quotes=(body as {quotes?:unknown[]})?.quotes;
    if(!Array.isArray(quotes))return null;
    const q=quotes.find(value=>{
      const item=value as {tokenSymbol?:unknown;deployments?:{chainId?:unknown}[]};
      return item?.tokenSymbol===symbol&&Array.isArray(item.deployments)&&item.deployments.some(d=>d.chainId===4663);
    }) as {bid?:unknown;ask?:unknown;currency?:unknown;isTradingHalt?:unknown;generatedAt?:unknown}|undefined;
    if(!q||q.currency!=='USD'||q.isTradingHalt!==false||typeof q.bid!=='string'||typeof q.ask!=='string'||typeof q.generatedAt!=='string')return null;
    if(!/^\d{1,8}(\.\d{1,4})?$/.test(q.bid)||!/^\d{1,8}(\.\d{1,4})?$/.test(q.ask))return null;
    const bid=Number(q.bid),ask=Number(q.ask),generatedAt=Date.parse(q.generatedAt);
    if(!Number.isFinite(bid)||!Number.isFinite(ask)||bid<=0||ask<bid||!Number.isFinite(generatedAt)||generatedAt>now+10000||now-generatedAt>60000)return null;
    const priceCents=Math.ceil(ask*100),bidCents=Math.floor(bid*100);
    if(!Number.isSafeInteger(priceCents)||priceCents<1||priceCents>100000000||!Number.isSafeInteger(bidCents)||bidCents<1)return null;
    return {symbol,priceCents,bidCents,askCents:priceCents,generatedAt,source:'Robinhood underlying-equity ask'};
  }catch{return null;}
}

export async function fetchPracticeMarketQuote(symbol:string,now=Date.now(),fetcher:typeof fetch=fetch):Promise<PracticeMarketQuote|null>{
  if(!/^[A-Z][A-Z0-9.]{0,7}$/.test(symbol))return null;
  try {
    const response=await fetcher(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(symbol)}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return null;
    return parsePracticeMarketQuote(await response.json(),symbol,now);
  }catch{return null;}
}

// Practice news triggers read Yahoo Finance RSS headlines. It is a partial public feed, not complete market news.
export type PracticeNewsItem={headline:string;source:string;publishedAt:number};
const decodeXml=(value:string)=>value.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Number(code)));
export function parsePracticeNewsFeed(body:string,now=Date.now(),limit=20):PracticeNewsItem[]{
  if(typeof body!=='string'||!body.includes('<item'))return [];
  const items:PracticeNewsItem[]=[];
  for(const block of body.match(/<item[\s>][\s\S]*?<\/item>/g)??[]){
    const title=block.match(/<title>([\s\S]*?)<\/title>/)?.[1]??'';
    const source=block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]??'Yahoo Finance';
    const pub=block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]??'';
    const headline=decodeXml(title.replace(/<[^>]+>/g,'')).trim().slice(0,300);
    const publishedAt=Date.parse(pub.trim());
    if(!headline||!Number.isFinite(publishedAt)||publishedAt>now+600000)continue;
    items.push({headline,source:decodeXml(source.replace(/<[^>]+>/g,'')).trim().slice(0,80)||'Yahoo Finance',publishedAt});
    if(items.length>=limit)break;
  }
  return items;
}
export async function fetchPracticeNews(symbol:string,now=Date.now(),fetcher:typeof fetch=fetch):Promise<PracticeNewsItem[]>{
  if(!/^[A-Z][A-Z0-9.]{0,7}$/.test(symbol))return [];
  try {
    const response=await fetcher(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`,{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return [];
    return parsePracticeNewsFeed(await response.text(),now);
  }catch{return [];}
}
