import {evaluateStrategy,practiceFill,revaluePracticeHolding,validateStrategy,utcDay,type Strategy,type PracticeEvidence,type StrategyResult} from './strategy.ts';
import type {Mandate} from './decision.ts';
import type {PracticeMarketQuote} from './practice-market.ts';
export type PracticeReceipt=StrategyResult&{id:string;outcome:'held'|'awaiting_approval'|'simulated_fill'|'declined';createdAt:string;approvalExpiresAt:number;trigger:'manual'|'foreground'|'background'};
export type PracticeSession={schema:'stock-steward-practice-v2';revision:number;strategy:Strategy|null;account:PracticeEvidence;receipts:PracticeReceipt[];running:boolean;background:boolean;mandateVersion:number;permissionExpiresAt:number|null;lastWallAt:number;lastCheckWallAt:number;nextDueAt:number;feedAvailable:boolean;priceSource?:'fixture'|'market';lastMarketQuoteAt?:number;lastMarketQuoteAtBySymbol?:Record<string,number>;marketStatus?:'waiting'|'fresh'|'unavailable'};
export type PracticeAction={action:'confirm';strategy:Strategy}|{action:'price';symbol:string;priceCents:number}|{action:'market_quote';quote:PracticeMarketQuote|null}|{action:'market_quotes';quotes:(PracticeMarketQuote|null)[]}|{action:'price_source';source:'fixture'|'market'}|{action:'approve'|'decline';id:string}|{action:'scenario';scenario:'healthy'|'stale'|'cash'|'daily'|'concentration'}|{action:'background';enabled:boolean}|{action:'authorize'|'start'|'pause'|'revoke'|'run'|'advance'|'refresh_quote'|'refresh'|'reset'};
export function newPracticeSession(now=Date.now()):PracticeSession{return {schema:'stock-steward-practice-v2',revision:0,strategy:null,account:{now,quoteAt:now,cashCents:100000,holdingsCents:{},shareUnitsNanos:{},valuationEstimated:false,pricesCents:{AAPL:18000,META:50000,MSFT:42000},previousPricesCents:{AAPL:18000,META:50000,MSFT:42000},spentDay:utcDay(now),spentCents:0,lastFillAt:null,grant:false},receipts:[],running:false,background:false,mandateVersion:0,permissionExpiresAt:null,lastWallAt:now,lastCheckWallAt:0,nextDueAt:now,feedAvailable:true,priceSource:'fixture',lastMarketQuoteAt:0,marketStatus:'waiting'};}
function stop(s:PracticeSession,why:string){s.running=false;s.background=false;s.account.grant=false;s.permissionExpiresAt=null;for(const r of s.receipts)if(r.outcome==='awaiting_approval'){r.outcome='declined';r.why=why;}}
function cancelPending(s:PracticeSession,why:string){for(const r of s.receipts)if(r.outcome==='awaiting_approval'){r.outcome='held';r.why=why;}}
export function transitionPractice(previous:PracticeSession,m:Mandate,action:PracticeAction,now=Date.now(),trigger:PracticeReceipt['trigger']='manual'){
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid practice clock.');
 const s=structuredClone(previous);if(s.schema!=='stock-steward-practice-v2')throw Error('Unsupported practice session.');
 if(s.mandateVersion!==m.version){stop(s,'Saved boundaries changed. Review and authorize practice again.');s.mandateVersion=m.version;}
 if(s.permissionExpiresAt!==null&&now>=s.permissionExpiresAt)stop(s,'Practice permission expired. Authorize it again before running.');
 for(const r of s.receipts)if(r.outcome==='awaiting_approval'&&now>=r.approvalExpiresAt){r.outcome='held';r.why='Approval expired. Run a new check; no trade was made.';}
 switch(action.action){
 case 'refresh':break;
 case 'price_source':{if(s.running||s.background||s.account.grant)throw Error('Revoke practice permission before changing the price source.');const fresh=newPracticeSession(now);fresh.strategy=s.strategy;fresh.mandateVersion=m.version;fresh.revision=s.revision;fresh.priceSource=action.source;if(action.source==='market'){fresh.account.quoteAt=0;fresh.feedAvailable=false;}return fresh;}
 case 'market_quote':
 case 'market_quotes':{
  if(s.priceSource!=='market')throw Error('Live price mode is not active.');
  const symbols=[...new Set([...(s.strategy?.kind==='portfolio'?s.strategy.targets!.map(t=>t.symbol):[s.strategy?.symbol].filter((x):x is string=>!!x)),...Object.entries(s.account.holdingsCents).filter(([,value])=>value>0).map(([held])=>held)])];
  const quotes=action.action==='market_quote'?[action.quote]:action.quotes;
  if(quotes.length!==symbols.length||quotes.some((quote,index)=>quote?.symbol!==symbols[index])){
   s.feedAvailable=false;s.account.quoteAt=0;s.marketStatus='unavailable';cancelPending(s,'Live price unavailable. Run a fresh check.');break;
  }
  let valid=true;
  for(const q of quotes){
   if(!q||!Number.isSafeInteger(q.priceCents)||q.priceCents<1||!Number.isSafeInteger(q.bidCents??q.priceCents)||(q.bidCents??q.priceCents)<1||(q.bidCents??q.priceCents)>q.priceCents||!Number.isSafeInteger(q.generatedAt)||q.generatedAt>now+10000||now-q.generatedAt>60000||q.generatedAt<(s.lastMarketQuoteAtBySymbol?.[q.symbol]??(symbols.length===1?s.lastMarketQuoteAt??0:0))){valid=false;break;}
  }
  if(!valid){s.feedAvailable=false;s.account.quoteAt=0;s.marketStatus='unavailable';cancelPending(s,'Live price unavailable. Run a fresh check.');break;}
  for(const quote of quotes){const q=quote!;const last=s.lastMarketQuoteAtBySymbol?.[q.symbol]??(symbols.length===1?s.lastMarketQuoteAt??0:0);const bid=q.bidCents??q.priceCents;
   if(q.generatedAt>last){const before=s.account.pricesCents[q.symbol]??bid,previousAsk=s.account.askPricesCents?.[q.symbol]??before;if(q.priceCents!==previousAsk||bid!==before)cancelPending(s,'Live price changed. Run a fresh check before approval.');s.account.previousPricesCents[q.symbol]=last>0?previousAsk:q.priceCents;s.account=revaluePracticeHolding(s.account,q.symbol,bid,before);s.account.pricesCents[q.symbol]=bid;s.account.askPricesCents={...s.account.askPricesCents,[q.symbol]:q.priceCents};s.lastMarketQuoteAtBySymbol={...s.lastMarketQuoteAtBySymbol,[q.symbol]:q.generatedAt};}
   s.account.quoteAtBySymbol={...s.account.quoteAtBySymbol,[q.symbol]:q.generatedAt};
  }
  s.account.quoteAt=Math.min(...quotes.map(q=>q!.generatedAt));s.lastMarketQuoteAt=s.account.quoteAt;s.feedAvailable=true;s.marketStatus='fresh';break;
 }
 case 'confirm':{const next=validateStrategy({...action.strategy,version:(s.strategy?.version??0)+1});if(next.kind==='portfolio'){if(next.targets!.some(target=>!m.allowedSymbols.includes(target.symbol)))throw Error('Portfolio targets must be approved in Mandate.');if(next.targets!.some(target=>target.targetBps>m.maxPositionBps))throw Error('Portfolio target exceeds your mandate concentration limit.');if(Object.entries(s.account.holdingsCents).some(([symbol,value])=>value>0&&!next.targets!.some(target=>target.symbol===symbol)))throw Error('Include every held stock in your portfolio targets, even with a 0% target.');}else if(!m.allowedSymbols.includes(next.symbol))throw Error('Choose a stock approved in Mandate.');s.strategy=next;stop(s,'Strategy replaced; old approval is no longer valid.');break;}
 case 'authorize':if(!s.strategy||m.version<1)throw Error('Confirm a strategy and save boundaries first.');s.account.grant=true;s.permissionExpiresAt=now+86400000;break;
 case 'start':if(!s.account.grant||!s.strategy)throw Error('Authorize practice first.');s.running=true;s.nextDueAt=now;break;
 case 'pause':s.running=false;s.background=false;break;
 case 'revoke':stop(s,'Practice permission revoked. No trade was made.');break;
 case 'background':if(action.enabled&&(!s.running||!s.account.grant))throw Error('Start the authorized practice agent first.');s.background=action.enabled;s.nextDueAt=now;break;
 case 'advance':if(s.priceSource==='market')throw Error('Test clock is unavailable with live prices.');cancelPending(s,'Test clock changed. Run a new check before approval.');s.account.now+=86400000;s.account.quoteAt=s.account.now;s.lastWallAt=now;break;
 case 'refresh_quote':if(s.priceSource==='market')throw Error('Fixture quote control is unavailable with live prices.');s.feedAvailable=true;cancelPending(s,'Quote refreshed. Run a new check before approval.');s.account.quoteAt=s.account.now;break;
 case 'price':{if(s.priceSource==='market')throw Error('Manual prices are unavailable with live prices.');if(!/^[A-Z][A-Z0-9.]{0,7}$/.test(action.symbol)||!Number.isSafeInteger(action.priceCents)||action.priceCents<1||action.priceCents>100000000)throw Error('Invalid simulated price.');cancelPending(s,'Simulated price changed. Run a new check before approval.');const before=s.account.pricesCents[action.symbol]??action.priceCents;s.account.previousPricesCents[action.symbol]=before;s.account=revaluePracticeHolding(s.account,action.symbol,action.priceCents,before);s.account.pricesCents[action.symbol]=action.priceCents;s.account.askPricesCents={...s.account.askPricesCents,[action.symbol]:action.priceCents};s.account.quoteAt=s.account.now;break;}
 case 'scenario':{if(s.priceSource==='market')throw Error('Fixture scenarios are unavailable with live prices.');s.running=false;s.background=false;s.lastCheckWallAt=0;cancelPending(s,'Test scenario changed. Run a new check.');const symbol=s.strategy?.symbol??'AAPL';s.feedAvailable=action.scenario!=='stale';s.account.cashCents=action.scenario==='cash'?0:100000;s.account.holdingsCents=action.scenario==='concentration'?{[symbol]:1000000}:{};const price=s.account.pricesCents[symbol]??18000;s.account.shareUnitsNanos=action.scenario==='concentration'?{[symbol]:((1000000n*1000000000n+BigInt(price)/2n)/BigInt(price)).toString()}:{};s.account.valuationEstimated=false;s.account.spentDay=utcDay(s.account.now);s.account.spentCents=action.scenario==='daily'?m.maxDailyBuyCents:0;s.account.lastFillAt=null;s.account.quoteAt=action.scenario==='stale'?s.account.now-120000:s.account.now;break;}
 case 'reset':{if(s.running||s.background||s.account.grant)throw Error('Revoke practice permission before resetting.');const fresh=newPracticeSession(now);fresh.strategy=s.strategy;fresh.mandateVersion=m.version;fresh.revision=s.revision;fresh.priceSource=s.priceSource??'fixture';if(fresh.priceSource==='market'){fresh.account.quoteAt=0;fresh.feedAvailable=false;}return fresh;}
 case 'decline':{const r=s.receipts.find(r=>r.id===action.id&&r.outcome==='awaiting_approval');if(!r)throw Error('This trade is no longer awaiting approval.');r.outcome='declined';r.why=`You declined the practice ${r.side??'buy'}.`;break;}
 case 'approve':{const r=s.receipts.find(r=>r.id===action.id&&r.outcome==='awaiting_approval');if(!r||!s.strategy)throw Error('Approval expired or changed. Run a new check.');if(s.priceSource==='market'&&(!s.feedAvailable||now-s.account.quoteAt>60000))throw Error('Live price is stale. Run a new check.');s.account=practiceFill(r,s.strategy,m,s.account,true);s.lastWallAt=now;r.outcome='simulated_fill';r.why=`Exact practice ${r.side??'buy'} approved. Simulated cash and holdings updated.`;break;}
 case 'run':{if(!s.strategy)throw Error('Confirm a strategy first.');if(s.receipts.some(r=>r.outcome==='awaiting_approval'))break;if(now-s.lastCheckWallAt<8000)break;
 s.account.now+=Math.max(0,now-s.lastWallAt);s.lastWallAt=now;s.lastCheckWallAt=now;if(s.feedAvailable&&s.priceSource!=='market')s.account.quoteAt=s.account.now;
 const result=evaluateStrategy(s.strategy,m,s.account);const outcome=result.status==='held'?'held':result.status==='ready'?'simulated_fill':'awaiting_approval';if(result.status==='ready')s.account=practiceFill(result,s.strategy,m,s.account);
 s.receipts.unshift({...result,id:crypto.randomUUID(),outcome,createdAt:new Date(result.observedAt).toISOString(),approvalExpiresAt:now+60000,trigger});
 // Keep purchases and approval decisions through long runs; bound repetitive holds separately.
 let decisions=0,holds=0;s.receipts=s.receipts.filter(r=>r.outcome==='held'?++holds<=40:++decisions<=100);s.nextDueAt=now+900000;break;}
 }
 return s;
}
