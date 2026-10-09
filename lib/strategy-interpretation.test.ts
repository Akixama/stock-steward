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
test('an explicit sell price survives an AI omission or wrong extraction',()=>{
 const direction='In Practice, use only my fake funds and existing AAPL holding. Sell exactly $1 worth of AAPL when its market price is at or above $330. Wait at least 1 hour between completed trades. Ask me to approve each sale. Never buy under this strategy, and stay within my saved Mandate.';
 const sale={...result,kind:'sell_threshold' as const,amountUsd:1,reserveUsd:null,intervalHours:1,thresholdUsd:null,targetPercent:null,driftPoints:null};
 const missing=reviewInterpretation(sale,direction,base);
 assert.equal(missing.draft?.kind,'sell_threshold');assert.equal(missing.draft?.thresholdCents,33000);assert.equal(missing.draft?.mode,'approval');assert.deepEqual(missing.questions,[]);
 assert.equal(reviewInterpretation({...sale,thresholdUsd:1},direction,base).draft?.thresholdCents,33000);
 const ambiguous=direction.replace('at or above $330','at or above $330 or above $340');
 assert.equal(reviewInterpretation(sale,ambiguous,base).draft,null);
});
test('AI portfolio drafts need explicit distinct targets and stay review-only',()=>{
 const direction='Rebalance AAPL to 10% and META to 15% of my fake portfolio. Buy or sell up to $1 per trade when either moves more than 2 percentage points from target, at least 24 hours apart. Keep $20 cash and ask before each trade.';
 const raw={...result,kind:'portfolio' as const,symbol:'AAPL',targets:[{symbol:'AAPL',targetPercent:10},{symbol:'META',targetPercent:15}],amountUsd:1,reserveUsd:20,intervalHours:24,targetPercent:null,driftPoints:2};
 const reviewed=reviewInterpretation(raw,direction,base);
 assert.equal(reviewed.draft?.kind,'portfolio');assert.deepEqual(reviewed.draft?.targets,[{symbol:'AAPL',targetBps:1000},{symbol:'META',targetBps:1500}]);assert.equal(reviewed.draft?.mode,'approval');
 assert.equal(reviewInterpretation(raw,direction.replace('15%','some amount'),base).draft,null);
 assert.equal(reviewInterpretation({...raw,targets:[{symbol:'AAPL',targetPercent:10},{symbol:'META',targetPercent:90}]},direction,base).draft,null);
});
test('AI can draft a two-sided price rule and asks for a missing sell price',()=>{
 const direction='Buy $1 of AAPL at $175 or below; sell $1 of held AAPL at $200 or above. Wait 1 hour between trades, keep $20 cash, and ask before each trade.';
 const raw={...result,kind:'price_band' as const,amountUsd:1,reserveUsd:20,intervalHours:1,thresholdUsd:175,sellThresholdUsd:200,targetPercent:null,driftPoints:null};
 assert.equal(reviewInterpretation(raw,direction,base).draft?.sellThresholdCents,20000);
 const missing=reviewInterpretation({...raw,sellThresholdUsd:null},direction.replace('$200','a price'),base);
 assert.equal(missing.draft,null);assert.ok(missing.questions.some(q=>q.includes('sell')));
});


test('news and scheduled-selling directions become bounded drafts',()=>{
 const newsResult={kind:'news_buy',symbol:'AAPL',targets:null,newsKeywords:['earnings beat','upgrade'],amountUsd:1,reserveUsd:20,intervalHours:24,thresholdUsd:null,sellThresholdUsd:null,targetPercent:null,driftPoints:null,maxMovementPercent:null,mode:'approval',summary:'Buy on matching headlines',questions:[],unsupported:[]};
 const news=reviewInterpretation(newsResult,'Buy $1 of AAPL when headlines mention earnings beat or upgrade, at most once every 24 hours. Keep $20 cash. Ask me first.',base);
 assert.equal(news.draft?.kind,'news_buy');assert.deepEqual(news.draft?.newsKeywords,['earnings beat','upgrade']);assert.equal(news.draft?.intervalHours,24);
 assert.equal(reviewInterpretation({...newsResult,newsKeywords:['invented words']},'Buy $1 of AAPL when headlines mention earnings beat, keep $20 cash',base).draft,null);
 const vague=reviewInterpretation({...newsResult,kind:'news_buy',newsKeywords:null},'Buy $1 of AAPL on good sentiment, keep $20 cash',base);
 assert.equal(vague.draft,null);assert.ok(vague.unsupported.length>0);
 const sellResult={kind:'sell_scheduled',symbol:'AAPL',targets:null,newsKeywords:null,amountUsd:1,reserveUsd:null,intervalHours:24,thresholdUsd:null,sellThresholdUsd:null,targetPercent:null,driftPoints:null,maxMovementPercent:null,mode:'approval',summary:'Sell on a schedule',questions:[],unsupported:[]};
 const sell=reviewInterpretation(sellResult,'Sell $1 of my AAPL practice shares every 24 hours. Ask me before each sale.',base);
 assert.equal(sell.draft?.kind,'sell_scheduled');assert.equal(sell.draft?.amountCents,100);
});