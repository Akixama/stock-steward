import type {LiveStrategySnapshot,LiveNews} from './live-strategy.ts';
export type NewsConfiguration={enabled:boolean;realTimeAccessVerified:boolean;commercialUseVerified:boolean;keyId?:string;secretKey?:string};
export type NewsResult={state:'ready'|'blocked';why:string;news:NonNullable<LiveStrategySnapshot['news']>};
// The origin is fixed. Credentials never follow redirects or enter request URLs.
export async function readLiveNews(symbols:string[],config:NewsConfiguration,fetcher:typeof fetch=fetch,now=Date.now()):Promise<NewsResult>{
 const stamp=Number.isFinite(new Date(now).getTime())?new Date(now).toISOString():'';
 const blocked=(why:string):NewsResult=>({state:'blocked',why,news:{verified:false,complete:false,observedAt:stamp,items:[]}});
 if(!config.enabled||!config.realTimeAccessVerified||!config.commercialUseVerified||!config.keyId||!config.secretKey)return blocked('A configured news account with verified real-time and application-use access is required.');
 if(!stamp||!Number.isSafeInteger(now)||!symbols.length||symbols.length>6||new Set(symbols).size!==symbols.length||symbols.some(s=>!/^[A-Z][A-Z0-9.]{0,7}$/.test(s)))return blocked('Invalid news symbols.');
 const items=new Map<string,LiveNews>(),pages=new Set<string>();let pageToken:string|undefined;
 const start=now-24*3600000;
 try{
  for(let page=0;page<10;page++){
   const url=new URL('https://data.alpaca.markets/v1beta1/news');
   url.search=new URLSearchParams({symbols:symbols.join(','),start:new Date(start).toISOString(),end:new Date(now).toISOString(),sort:'desc',limit:'50',include_content:'false',...(pageToken?{page_token:pageToken}:{})}).toString();
   const response=await fetcher(url.toString(),{headers:{'APCA-API-KEY-ID':config.keyId,'APCA-API-SECRET-KEY':config.secretKey},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
   const serverTime=Date.parse(response.headers.get('date')??'');
   if(!response.ok||!Number.isFinite(serverTime)||serverTime>now+1000||now-serverTime>30000)throw Error('News response unavailable or stale.');
   const body=await response.json() as {news:unknown[];next_page_token?:unknown};
   if(!Array.isArray(body.news)||body.news.length>50)throw Error('Incomplete news response.');
   for(const unknownItem of body.news){
    const item=unknownItem as {id:number;headline:string;symbols:string[];source:string;created_at:string;updated_at:string};
    if(!item||!Number.isSafeInteger(item.id)||item.id<1||typeof item.headline!=='string'||!item.headline.trim()||item.headline.length>2000||!Array.isArray(item.symbols)||item.symbols.some(s=>typeof s!=='string')||typeof item.source!=='string'||!item.source||item.source.length>200)throw Error('Invalid news item.');
    const created=Date.parse(item.created_at),updated=Date.parse(item.updated_at);
    if(!Number.isFinite(created)||!Number.isFinite(updated)||created>now||updated>now||updated<created)throw Error('Invalid news timestamp.');
    if(created<start||!item.symbols.some(s=>symbols.includes(s)))continue;
    const news:LiveNews={id:'alpaca:'+item.id,symbols:item.symbols.filter(s=>symbols.includes(s)),headline:item.headline,source:item.source,publishedAt:new Date(created).toISOString()};
    const old=items.get(news.id);if(old&&JSON.stringify(old)!==JSON.stringify(news))throw Error('News changed during pagination.');items.set(news.id,news);
   }
   if(body.next_page_token===null||body.next_page_token===undefined||body.next_page_token==='')return {state:'ready',why:'Authenticated news coverage loaded for the requested interval.',news:{verified:true,complete:true,observedAt:stamp,items:[...items.values()]}};
   if(typeof body.next_page_token!=='string'||body.next_page_token.length>4096||pages.has(body.next_page_token))throw Error('News pagination incomplete.');
   pageToken=body.next_page_token;pages.add(pageToken);
  }
 }catch{/* Provider errors and credentials are never included in public errors. */}
 return blocked('Fresh complete news coverage could not be verified. No news trade is ready.');
}

export async function configuredLiveNews():Promise<NewsConfiguration>{
 const {env}=await import('cloudflare:workers');
 return {enabled:env.STEWARD_NEWS_ENABLED==='true',realTimeAccessVerified:env.STEWARD_NEWS_REALTIME_VERIFIED==='true',commercialUseVerified:env.STEWARD_NEWS_USE_VERIFIED==='true',keyId:env.STEWARD_NEWS_KEY_ID,secretKey:env.STEWARD_NEWS_SECRET_KEY};
}
