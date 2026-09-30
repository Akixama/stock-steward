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
