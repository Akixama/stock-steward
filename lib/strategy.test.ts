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
