import test from 'node:test';import assert from 'node:assert/strict';import {reviewInterpretation} from './strategy-interpretation.ts';import type {Strategy} from './strategy.ts';
const base:Strategy={version:1,kind:'scheduled',direction:'',symbol:'AAPL',amountCents:100,reserveCents:2000,intervalHours:24,thresholdCents:18000,targetBps:1000,driftBps:200,maxMovementBps:500,mode:'approval'};
const result={kind:'allocation',symbol:'AAPL',amountUsd:1,reserveUsd:20,intervalHours:null,thresholdUsd:null,targetPercent:10,driftPoints:2,maxMovementPercent:null,mode:'approval',summary:'Build AAPL toward 10%',questions:[],unsupported:[]};
test('AI draft preserves explicit rules without authorization',()=>{const x=reviewInterpretation(result,'Build AAPL toward 10%, buy $1 below 8%, keep $20 cash, ask me first',base);assert.equal(x.draft?.amountCents,100);assert.equal(x.draft?.driftBps,200);assert.equal(x.draft?.mode,'approval');});
test('missing fields and unsupported actions cannot become drafts',()=>{assert.equal(reviewInterpretation({...result,amountUsd:null},'Build AAPL',base).draft,null);assert.equal(reviewInterpretation(result,'Sell AAPL on news',base).draft,null);});
test('model cannot invent automatic execution or extra capabilities',()=>{assert.equal(reviewInterpretation({...result,mode:'automatic'},'Buy AAPL, ask me first',base).draft,null);assert.throws(()=>reviewInterpretation({...result,grant:true},'Build AAPL toward 10%, buy $1.001 below 8%, keep $20 cash',base));});
test('money precision handles floating point and rejects extra decimals',()=>{assert.equal(reviewInterpretation({...result,amountUsd:0.29},'Build AAPL toward 10%, buy $0.29 below 8%, keep $20 cash, ask me first',base).draft?.amountCents,29);assert.throws(()=>reviewInterpretation({...result,amountUsd:1.001},'Build AAPL toward 10%, buy $1.001 below 8%, keep $20 cash',base));});

test('invented numeric values and symbols cannot become a draft',()=>{const x=reviewInterpretation(result,'Buy AAPL regularly and keep $20 cash',base);assert.equal(x.draft,null);assert.equal(x.result.amountUsd,null);assert.ok(x.questions.includes('What is the maximum amount for each trade?'));assert.equal(reviewInterpretation(result,'Build META toward 10%, buy $1 below 8%, keep $20 cash',base).draft,null);});
test('explicit accumulation does not ask for an absolute simulated price',()=>{
 const direction='In Practice, cautiously accumulate $1 of AAPL no more than once every 1 hour. Buy only when its simulated price has moved no more than 2% since the previous price. Keep at least $20 in cash. Execute automatically within my saved limits.';
 const confused={...result,kind:'threshold' as const,intervalHours:null,thresholdUsd:null,targetPercent:null,driftPoints:null,maxMovementPercent:null,mode:'automatic' as const,summary:'Wait for a simulated price',questions:['What is the simulated price?']};
 const reviewed=reviewInterpretation(confused,direction,base);
 assert.equal(reviewed.draft?.kind,'accumulate');assert.equal(reviewed.draft?.intervalHours,1);assert.equal(reviewed.draft?.maxMovementBps,200);assert.equal(reviewed.draft?.mode,'automatic');assert.deepEqual(reviewed.questions,[]);
});
test('an actual price threshold still asks for its missing ceiling',()=>{
 const reviewed=reviewInterpretation({...result,kind:'threshold',thresholdUsd:null,targetPercent:null,driftPoints:null,questions:[]},'Buy $1 of AAPL below my chosen price and keep $20 cash',base);
 assert.equal(reviewed.draft,null);assert.ok(reviewed.questions.includes('At or below which share price should I buy?'));
});
test('explicit sale and rebalance directions can become reviewable drafts',()=>{
 const sale={...result,kind:'sell_threshold' as const,amountUsd:1,reserveUsd:null,intervalHours:24,thresholdUsd:350,targetPercent:null,driftPoints:null};
 const a=reviewInterpretation(sale,'Sell $1 of AAPL at or above $350, at least 24 hours between trades, and ask before each sale.',base);
 assert.equal(a.draft?.kind,'sell_threshold');assert.equal(a.draft?.thresholdCents,35000);assert.equal(a.draft?.intervalHours,24);
 assert.equal(reviewInterpretation(sale,'Buy $1 of AAPL below $350 every 24 hours',base).draft,null);
 const rebalance={...result,kind:'rebalance' as const,amountUsd:1,reserveUsd:20,intervalHours:24,thresholdUsd:null,targetPercent:10,driftPoints:2,mode:'automatic' as const};
 const b=reviewInterpretation(rebalance,'Rebalance AAPL toward 10%. Buy or sell up to $1 when it moves more than 2 percentage points from target, every 24 hours. Keep $20 cash and execute automatically.',base);
 assert.equal(b.draft?.kind,'rebalance');assert.equal(b.draft?.targetBps,1000);assert.equal(b.draft?.driftBps,200);assert.equal(b.draft?.mode,'automatic');
});
