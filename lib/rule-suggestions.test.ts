import test from 'node:test';
import assert from 'node:assert/strict';
import {contextFor,reviewSuggestions} from './rule-suggestions.ts';
const samples=[100,98,96,95,97,99,101,103,102,104].map((p,i)=>({observedAt:new Date(Date.UTC(2026,9,10+i)).toISOString(),bidCents:p*100,askCents:p*100+10}));
const m=contextFor('AAPL',samples)!;const limits={maxOrderCents:2000,maxDailyBuyCents:5000};
test('market context summarises real prices',()=>{assert.equal(m.lastCents,10400);assert.equal(m.high30dCents,10400);assert.equal(m.low30dCents,9500);});
test('only sane suggestions inside the Limits survive, each replayed',()=>{
 const out=reviewSuggestions({suggestions:[
  {kind:'threshold',symbol:'AAPL',amountUsd:50,priceUsd:98,checkMinutes:15,reason:'Buy a dip back to $98.'},      // amount capped to $20
  {kind:'sell_trailing',symbol:'AAPL',amountUsd:10,trailPercent:7,reason:'Protect gains.'},                         // snaps to 8%
  {kind:'threshold',symbol:'TSLA',amountUsd:10,priceUsd:200,reason:'Not allowed.'},                                // not in Limits
  {kind:'sell_below',symbol:'AAPL',amountUsd:10,priceUsd:150,reason:'Wrong side.'},                                // above price
  {kind:'threshold',symbol:'AAPL',amountUsd:10,priceUsd:20,reason:'Absurd.'},                                      // >30% away
 ]},[m],limits,[]);
 assert.equal(out.length,2);
 assert.equal(out[0].rule.amountCents,2000);assert.equal(out[0].rule.thresholdCents,9800);assert.ok(out[0].replay);
 assert.equal(out[1].rule.trailBps,800);assert.equal(out[1].rule.intervalMinutes,5);
});
test('duplicates of existing rules and malformed output are rejected',()=>{
 const out=reviewSuggestions({suggestions:[{kind:'threshold',symbol:'AAPL',amountUsd:10,priceUsd:98,reason:'x'}]},[m],limits,[{kind:'threshold',symbol:'AAPL',amountCents:500,thresholdCents:9800,intervalMinutes:15}]);
 assert.equal(out.length,0);
 assert.throws(()=>reviewSuggestions({nope:true},[m],limits,[]),/AI_SCHEMA/);
});
