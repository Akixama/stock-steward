import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateStrategy,practiceFill,revaluePracticeHolding,validateStrategy,utcDay,type Strategy,type PracticeEvidence} from './strategy.ts';
import type {Mandate} from './decision.ts';
const now=Date.UTC(2026,8,27,12);
const s:Strategy={version:1,kind:'scheduled',direction:'Buy cautiously',symbol:'AAPL',amountCents:100,reserveCents:2000,intervalHours:24,thresholdCents:18000,targetBps:1000,driftBps:200,maxMovementBps:500,mode:'approval'};
const m:Mandate={version:1,allowedSymbols:['AAPL'],maxOrderCents:200,maxDailyBuyCents:300,maxPositionBps:2000,requireApproval:true};
const e:PracticeEvidence={now,quoteAt:now,cashCents:100000,holdingsCents:{},pricesCents:{AAPL:18000},previousPricesCents:{AAPL:18000},spentDay:utcDay(now),spentCents:0,lastFillAt:null,grant:true};
test('approval rechecks exact evidence; fill conserves cash plus positions and replay fails',()=>{
 const r=evaluateStrategy(s,m,e);assert.equal(r.status,'awaiting_approval');assert.throws(()=>practiceFill(r,s,m,e));
 const filled=practiceFill(r,s,m,e,true);assert.equal(filled.cashCents,99900);assert.equal(filled.holdingsCents.AAPL,100);assert.equal(filled.spentCents,100);assert.equal(filled.lastFillAt,now);
 assert.throws(()=>practiceFill(r,s,m,filled,true));assert.throws(()=>practiceFill(r,{...s,version:2},m,e,true));assert.throws(()=>practiceFill(r,s,{...m,version:2},e,true));assert.throws(()=>practiceFill(r,s,m,{...e,grant:false},true));
});
test('schedule, threshold, allocation and movement trigger only under explicit conditions',()=>{
 assert.equal(evaluateStrategy(s,m,{...e,lastFillAt:now}).status,'held');
 assert.equal(evaluateStrategy({...s,kind:'threshold',thresholdCents:17999},m,e).status,'held');
 assert.equal(evaluateStrategy({...s,kind:'threshold'},m,e).status,'awaiting_approval');
 assert.equal(evaluateStrategy({...s,kind:'allocation'},m,{...e,holdingsCents:{AAPL:20000}}).status,'held');
 assert.equal(evaluateStrategy({...s,kind:'allocation'},m,e).status,'awaiting_approval');
 assert.equal(evaluateStrategy({...s,kind:'allocation',amountCents:200,targetBps:1,driftBps:0},m,e).status,'held');
 assert.equal(evaluateStrategy({...s,kind:'accumulate'},m,{...e,previousPricesCents:{AAPL:10000}}).status,'held');
 assert.equal(evaluateStrategy({...s,kind:'accumulate'},m,e).status,'awaiting_approval');
});
test('automatic purchases obey shared daily cap and UTC reset, reserve and concentration',()=>{
 const automatic={...s,kind:'threshold',mode:'automatic'} as Strategy;
 let a=e;for(let i=0;i<3;i++){const r=evaluateStrategy(automatic,m,a);assert.equal(r.status,'ready');a=practiceFill(r,automatic,m,a);}
 assert.equal(evaluateStrategy(automatic,m,a).status,'held');
 const tomorrow={...a,now:now+86400000,quoteAt:now+86400000};const r=evaluateStrategy(automatic,m,tomorrow);assert.equal(r.status,'ready');assert.equal(practiceFill(r,automatic,m,tomorrow).spentCents,100);
 assert.equal(evaluateStrategy(s,m,{...e,cashCents:2050}).status,'held');assert.equal(evaluateStrategy(s,m,{...e,holdingsCents:{AAPL:50000}}).status,'held');
});
test('missing permission, stale/future quotes, disallowed stock and malformed rules hold or reject',()=>{
 for(const changed of [{grant:false},{quoteAt:now-60001},{quoteAt:now+10001},{pricesCents:{}},{cashCents:0}])assert.equal(evaluateStrategy(s,m,{...e,...changed}).status,'held');
 assert.equal(evaluateStrategy(s,m,{...e,quoteAt:now+100}).status,'awaiting_approval');
 assert.equal(evaluateStrategy(s,{...m,allowedSymbols:['META']},e).status,'held');
 for(const patch of [{amountCents:NaN},{intervalHours:0},{version:0},{mode:'unbounded'},{targetBps:10001}])assert.throws(()=>validateStrategy({...s,...patch} as Strategy));
 assert.throws(()=>evaluateStrategy(s,m,{...e,cashCents:NaN}));
});
test('fractional-share valuation does not lose cents on each quote',()=>{
 const automatic={...s,kind:'threshold',thresholdCents:33000,mode:'automatic'} as Strategy;
 const mandate={...m,maxDailyBuyCents:1000};let account:PracticeEvidence={...e,pricesCents:{AAPL:33000},previousPricesCents:{AAPL:33000}};
 for(let i=0;i<6;i++){const result=evaluateStrategy(automatic,mandate,account);assert.equal(result.status,'ready');account=practiceFill(result,automatic,mandate,account);}
 assert.equal(account.cashCents,99400);assert.equal(account.holdingsCents.AAPL,600);
 for(let i=0;i<200;i++){const from=i%2===0?33000:33001,to=i%2===0?33001:33000;account=revaluePracticeHolding(account,'AAPL',to,from);}
 assert.equal(account.holdingsCents.AAPL,600);
 assert.equal(account.valuationEstimated,false);
 const legacy=revaluePracticeHolding({...e,holdingsCents:{AAPL:515},pricesCents:{AAPL:33034}},'AAPL',33035,33034);
 assert.equal(legacy.holdingsCents.AAPL,515);assert.equal(legacy.valuationEstimated,true);
});
test('practice sale requires held precise shares and preserves fake portfolio value',()=>{
 const buy={...s,kind:'threshold',mode:'automatic'} as Strategy;
 let account=e;
 for(let i=0;i<2;i++)account=practiceFill(evaluateStrategy(buy,m,account),buy,m,account);
 const at=now+3600000;
 account={...account,now:at,quoteAt:at,spentCents:m.maxDailyBuyCents};
 const sale={...s,kind:'sell_threshold',thresholdCents:18000,intervalHours:1,mode:'approval'} as Strategy;
 const proposal=evaluateStrategy(sale,m,account);
 assert.equal(proposal.side,'sell');assert.equal(proposal.status,'awaiting_approval');
 assert.equal(proposal.checks.find(check=>check.name==='Strategy trigger')?.detail,'Observed sale price $180.00; sell at or above $180.00. 60 minutes since the last completed trade. At least 1 hour between trades.');
 const tooSoon=evaluateStrategy(sale,m,{...account,now:at-60000,quoteAt:at-60000});
 assert.equal(tooSoon.status,'held');
 assert.match(tooSoon.why,/59 minutes since the last completed trade\. At least 1 hour between trades\./);
 assert.throws(()=>practiceFill(proposal,sale,m,account));
 const before=account.cashCents+account.holdingsCents.AAPL;
 const filled=practiceFill(proposal,sale,m,account,true);
 assert.equal(filled.cashCents,99900);assert.equal(filled.holdingsCents.AAPL,100);
 assert.equal(filled.cashCents+filled.holdingsCents.AAPL,before);
 assert.equal(filled.spentCents,m.maxDailyBuyCents);
 assert.throws(()=>practiceFill(proposal,sale,m,filled,true));
 assert.equal(evaluateStrategy(sale,m,{...account,shareUnitsNanos:{},valuationEstimated:true}).status,'held');
 assert.equal(evaluateStrategy(sale,m,{...account,pricesCents:{AAPL:17999}}).status,'held');
 assert.equal(evaluateStrategy(sale,m,{...account,holdingsCents:{AAPL:0},shareUnitsNanos:{AAPL:'0'}}).status,'held');
});
test('rebalancing buys below its band, sells above it, and waits between trades',()=>{
 const strategy={...s,kind:'rebalance',targetBps:100,driftBps:50,intervalHours:1,mode:'automatic'} as Strategy;
 const buy=evaluateStrategy(strategy,m,e);
 assert.equal(buy.side,'buy');assert.equal(buy.status,'ready');
 let account=practiceFill(buy,strategy,m,e);
 const at=now+3600000;
 account=revaluePracticeHolding({...account,now:at,quoteAt:at,previousPricesCents:{AAPL:18000},pricesCents:{AAPL:360000}},'AAPL',360000,18000);
 const sell=evaluateStrategy(strategy,m,account);
 assert.equal(sell.side,'sell');assert.equal(sell.status,'ready');
 const total=account.cashCents+account.holdingsCents.AAPL;
 account=practiceFill(sell,strategy,m,account);
 assert.equal(account.cashCents+account.holdingsCents.AAPL,total);
 assert.equal(account.cashCents,100000);
 assert.equal(evaluateStrategy(strategy,m,{...account,now:at+8000,quoteAt:at+8000}).status,'held');
 const inBand={...e,holdingsCents:{AAPL:1000},cashCents:99000,shareUnitsNanos:{AAPL:'55555556'}};
 assert.equal(evaluateStrategy(strategy,m,inBand).status,'held');
 assert.throws(()=>validateStrategy({...strategy,targetBps:9900,driftBps:200}));
});
test('portfolio rules select one bounded trade, prefer reducing overweight holdings, and require every quote',()=>{
 const mandate={...m,allowedSymbols:['AAPL','META']};
 const portfolio:Strategy={...s,kind:'portfolio',targets:[{symbol:'AAPL',targetBps:1000},{symbol:'META',targetBps:1500}],driftBps:200,intervalHours:1,mode:'automatic'};
 const account:PracticeEvidence={...e,pricesCents:{AAPL:18000,META:50000},previousPricesCents:{AAPL:18000,META:50000},quoteAtBySymbol:{AAPL:now,META:now}};
 const first=evaluateStrategy(portfolio,mandate,account);assert.equal(first.status,'ready');assert.equal(first.symbol,'META');assert.equal(first.side,'buy');
 const bought=practiceFill(first,portfolio,mandate,account);assert.equal(bought.cashCents,99900);assert.equal(bought.holdingsCents.META,100);
 assert.equal(evaluateStrategy(portfolio,mandate,{...account,quoteAtBySymbol:{AAPL:now,META:now-61000}}).status,'held');
 assert.equal(evaluateStrategy(portfolio,m,account).status,'held');
 const overweight:PracticeEvidence={...account,cashCents:70000,holdingsCents:{AAPL:30000},shareUnitsNanos:{AAPL:'1666666667'},valuationEstimated:false};
 const sale=evaluateStrategy(portfolio,mandate,overweight);assert.equal(sale.status,'ready');assert.equal(sale.symbol,'AAPL');assert.equal(sale.side,'sell');
 const sold=practiceFill(sale,portfolio,mandate,overweight);assert.equal(sold.cashCents,70100);assert.equal(sold.holdingsCents.AAPL,29900);
 assert.throws(()=>practiceFill(sale,portfolio,mandate,sold));
 for(const targets of [[{symbol:'AAPL',targetBps:8000},{symbol:'META',targetBps:3000}],[{symbol:'AAPL',targetBps:1000},{symbol:'AAPL',targetBps:2000}]])assert.throws(()=>validateStrategy({...portfolio,targets}));
});
test('live quote spread uses ask to buy and bid to value or sell',()=>{
 const mandate={...m,maxDailyBuyCents:500};
 const rule={...s,kind:'threshold',thresholdCents:18001,mode:'automatic'} as Strategy;
 const account={...e,pricesCents:{AAPL:18000},askPricesCents:{AAPL:18001}};
 const bought=practiceFill(evaluateStrategy(rule,mandate,account),rule,mandate,account);
 assert.equal(bought.cashCents,99900);assert.equal(bought.holdingsCents.AAPL,100);
 const saleRule={...s,kind:'sell_threshold',intervalHours:1,thresholdCents:18000,mode:'automatic'} as Strategy;
 const later={...bought,now:now+3600000,quoteAt:now+3600000};
 const sale=evaluateStrategy(saleRule,mandate,later);assert.equal(sale.side,'sell');
 assert.equal(practiceFill(sale,saleRule,mandate,later).cashCents,100000);
 const wide={...s,kind:'threshold',mode:'automatic',amountCents:10000,thresholdCents:20000} as Strategy;
 const wideMandate={...m,maxOrderCents:10000,maxDailyBuyCents:10000};
 const marked=practiceFill(evaluateStrategy(wide,wideMandate,{...e,pricesCents:{AAPL:18000},askPricesCents:{AAPL:20000}}),wide,wideMandate,{...e,pricesCents:{AAPL:18000},askPricesCents:{AAPL:20000}});
 assert.equal(marked.cashCents,90000);assert.equal(marked.holdingsCents.AAPL,9000);
});
test('price range buys below its ceiling and sells held shares above its floor',()=>{
 const range:Strategy={...s,kind:'price_band',thresholdCents:18000,sellThresholdCents:20000,intervalHours:1,mode:'automatic'};
 const buy=evaluateStrategy(range,m,e);assert.equal(buy.status,'ready');assert.equal(buy.side,'buy');
 const bought=practiceFill(buy,range,m,e);
 const middle={...bought,now:now+3600000,quoteAt:now+3600000,pricesCents:{AAPL:19000},askPricesCents:{AAPL:19001}};
 assert.equal(evaluateStrategy(range,m,middle).status,'held');
 const high=revaluePracticeHolding({...middle,pricesCents:{AAPL:20000},askPricesCents:{AAPL:20001}},'AAPL',20000,18000);
 const sell=evaluateStrategy(range,m,high);assert.equal(sell.status,'ready');assert.equal(sell.side,'sell');
 const after=practiceFill(sell,range,m,high);assert.equal(after.cashCents,100000);assert.ok((after.holdingsCents.AAPL??0)>0);
 const loss={...s,kind:'sell_below',thresholdCents:18000,intervalHours:1,mode:'automatic'} as Strategy;
 assert.equal(evaluateStrategy(loss,m,high).status,'held');
 assert.equal(evaluateStrategy(loss,m,{...bought,now:now+3600000,quoteAt:now+3600000}).side,'sell');
 assert.throws(()=>validateStrategy({...range,sellThresholdCents:17999}));
});
