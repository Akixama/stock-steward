import test from 'node:test';
import assert from 'node:assert/strict';
import {replayRule,type ReplaySample} from './replay.ts';
// Hourly prices: $100 falling to $80 then back up to $110.
const prices=[100,98,95,92,90,88,85,82,80,84,90,96,102,110];
const samples:ReplaySample[]=prices.map((p,i)=>({observedAt:new Date(Date.UTC(2026,9,20,i)).toISOString(),bidCents:p*100-10,askCents:p*100+10}));
const limits={maxOrderCents:1000,maxDailyBuyCents:5000};

test('a buy-the-dip rule buys only at or below the trigger, at most once per interval',()=>{
 const r=replayRule({kind:'threshold',symbol:'AAPL',amountCents:1000,thresholdCents:9000,intervalMinutes:60},limits,samples);
 assert.deepEqual(r.trades.map(t=>t.priceCents),[8810,8510,8210,8010,8410],'$90 asks at $90.10, above the trigger');
 assert.equal(r.spentCents,5000);assert.equal(r.buys,5);
 assert.ok(r.resultCents>0,'bought the dip, price recovered');
 assert.ok(r.benchmarkCents!<r.positionValueCents,'beats spending it all on day one');
 assert.match(r.summary,/bought 5 times/);
});
test('the daily limit is respected and counted',()=>{
 const r=replayRule({kind:'scheduled',symbol:'AAPL',amountCents:1000,thresholdCents:1,intervalMinutes:60},limits,samples);
 assert.equal(r.buys,5);assert.equal(r.skippedDaily,9);
});
test('a stop-loss sells as the price falls, and is compared with just holding',()=>{
 const r=replayRule({kind:'sell_below',symbol:'AAPL',amountCents:1000,thresholdCents:9000,intervalMinutes:60},limits,samples);
 assert.equal(r.sells,7);assert.equal(r.receivedCents,7000);
 assert.ok(r.resultCents<0,'selling the dip lost to holding through the recovery');
 assert.match(r.summary,/sold 7 times/);
});
test('a trigger never reached says so, and too little data is refused',()=>{
 const r=replayRule({kind:'sell_threshold',symbol:'AAPL',amountCents:1000,thresholdCents:20000,intervalMinutes:60},limits,samples);
 assert.equal(r.sells,0);assert.match(r.summary,/never reached/);
 assert.throws(()=>replayRule({kind:'threshold',symbol:'AAPL',amountCents:1000,thresholdCents:9000,intervalMinutes:60},limits,samples.slice(0,1)),/Not enough/);
});
