// Replay: run a Real-money rule over the real prices Stock Steward saved, and
// see every trade it would have made before giving it money. Fees, slippage
// and gaps between saved prices are not modelled; it is a guide, not a promise.
export type ReplayRule={kind:'threshold'|'scheduled'|'sell_below'|'sell_threshold'|'sell_trailing';symbol:string;amountCents:number;thresholdCents:number;intervalMinutes:number;trailBps?:number};
export type ReplaySample={observedAt:string;bidCents:number;askCents:number};
export type ReplayTrade={at:string;side:'buy'|'sell';priceCents:number;cents:number};
export type ReplayResult={symbol:string;from:string;to:string;checks:number;trades:ReplayTrade[];buys:number;sells:number;skippedDaily:number;
 spentCents:number;receivedCents:number;averagePriceCents:number|null;positionValueCents:number;resultCents:number;resultPct:number|null;
 benchmarkCents:number|null;firstPriceCents:number;lastPriceCents:number;summary:string};

const $=(c:number)=>`$${(c/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export const SELL_START_LOTS=10;

export function replayRule(rule:ReplayRule,limits:{maxOrderCents:number;maxDailyBuyCents:number},samples:ReplaySample[]):ReplayResult{
 const usable=samples.filter(s=>Number.isSafeInteger(s.bidCents)&&Number.isSafeInteger(s.askCents)&&s.bidCents>0&&s.askCents>0&&Number.isFinite(Date.parse(s.observedAt))).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));
 if(usable.length<2)throw Error('Not enough saved prices for this stock yet. Try again after a few days of checks.');
 const sell=rule.kind==='sell_below'||rule.kind==='sell_threshold'||rule.kind==='sell_trailing';
 if(rule.kind==='sell_trailing'&&(!rule.trailBps||rule.trailBps<100||rule.trailBps>5000))throw Error('Choose how far from the high to sell.');
 let high=0;
 const amount=Math.min(rule.amountCents,limits.maxOrderCents),gap=Math.max(1,rule.intervalMinutes)*60_000;
 const first=usable[0],last=usable[usable.length-1];
 // Sell rules start holding SELL_START_LOTS trades' worth, bought at the first bid.
 let units=sell?amount*SELL_START_LOTS/first.bidCents:0;
 const startUnits=units;
 let spent=0,received=0,lastTrade=-Infinity,skippedDaily=0;const perDay=new Map<string,number>();const trades:ReplayTrade[]=[];
 for(const s of usable){
  const t=Date.parse(s.observedAt);high=Math.max(high,s.bidCents);if(t-lastTrade<gap)continue;
  if(!sell){
   const trigger=rule.kind==='scheduled'||s.askCents<=rule.thresholdCents;if(!trigger)continue;
   const day=s.observedAt.slice(0,10),used=perDay.get(day)??0;
   if(used+amount>limits.maxDailyBuyCents){skippedDaily++;continue;}
   perDay.set(day,used+amount);units+=amount/s.askCents;spent+=amount;lastTrade=t;
   if(trades.length<200)trades.push({at:s.observedAt,side:'buy',priceCents:s.askCents,cents:amount});
  }else{
   const stop=rule.kind==='sell_trailing'?Math.floor(high*(10000-rule.trailBps!)/10000):rule.thresholdCents;
   const trigger=rule.kind==='sell_threshold'?s.bidCents>=stop:s.bidCents<=stop;if(!trigger||units<=0)continue;
   const cents=Math.min(amount,Math.floor(units*s.bidCents));if(cents<1)continue;
   units-=cents/s.bidCents;received+=cents;lastTrade=t;
   if(trades.length<200)trades.push({at:s.observedAt,side:'sell',priceCents:s.bidCents,cents});
  }
 }
 const positionValue=Math.round(units*last.bidCents);
 const buys=trades.filter(t=>t.side==='buy').length,sells=trades.filter(t=>t.side==='sell').length;
 let result:number,pct:number|null,benchmark:number|null,summary:string;
 if(!sell){
  result=positionValue-spent;pct=spent?result/spent*100:null;
  benchmark=spent?Math.round(spent/first.askCents*last.bidCents):null;
  summary=buys?`Over this period the rule would have bought ${buys} time${buys===1?'':'s'}, spending ${$(spent)} at an average of ${$(Math.round(spent/(units||1)))} a share. That would be worth ${$(positionValue)} now (${result>=0?'+':''}${pct!.toFixed(1)}%). Spending the same ${$(spent)} on day one would be worth ${$(benchmark!)}.`
   :`The price never reached your trigger, so the rule would not have bought anything.`;
 }else{
  const startValue=Math.round(startUnits*first.bidCents),held=Math.round(startUnits*last.bidCents);
  result=received+positionValue-held;pct=startValue?result/startValue*100:null;benchmark=held;
  summary=sells?`Starting with ${$(startValue)} of ${rule.symbol}, the rule would have sold ${sells} time${sells===1?'':'s'} for ${$(received)}. You would have ${$(received+positionValue)} in total versus ${$(held)} if you had just held (${result>=0?'+':''}${$(result)}).`
   :`The price never reached your trigger, so the rule would not have sold anything.`;
 }
 return {symbol:rule.symbol,from:first.observedAt,to:last.observedAt,checks:usable.length,trades,buys,sells,skippedDaily,spentCents:spent,receivedCents:received,
  averagePriceCents:!sell&&units>0?Math.round(spent/units):null,positionValueCents:positionValue,resultCents:result,resultPct:pct===null?null:Math.round(pct*10)/10,benchmarkCents:benchmark,
  firstPriceCents:sell?first.bidCents:first.askCents,lastPriceCents:last.bidCents,summary};
}
