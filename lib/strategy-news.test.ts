import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateStrategy,matchNewsItems,practiceFill,validateStrategy,NEWS_WINDOW_MS,type Strategy,type PracticeEvidence} from './strategy.ts';
import type {Mandate} from './decision.ts';
const now=Date.UTC(2026,8,27,12);
const s:Strategy={version:1,kind:'scheduled',direction:'Buy cautiously',symbol:'AAPL',amountCents:100,reserveCents:2000,intervalHours:24,thresholdCents:18000,targetBps:1000,driftBps:200,maxMovementBps:500,mode:'approval'};
const m:Mandate={version:1,allowedSymbols:['AAPL','META','MSFT','NVDA','TSLA','AMZN'],maxOrderCents:200,maxDailyBuyCents:300,maxPositionBps:2000,requireApproval:true};
const e:PracticeEvidence={now,quoteAt:now,cashCents:100000,holdingsCents:{},pricesCents:{AAPL:18000},askPricesCents:{AAPL:18000},previousPricesCents:{AAPL:18000},spentDay:'2026-09-27',spentCents:0,lastFillAt:null,grant:true,shareUnitsNanos:{},newsItems:[]};
const held:PracticeEvidence={...e,holdingsCents:{AAPL:10000},shareUnitsNanos:{AAPL:'55555555555'}};
test('sell_scheduled sells held shares on the interval and stops after a fill',()=>{
 const st:Strategy={...s,kind:'sell_scheduled'};
 assert.equal(evaluateStrategy(st,m,held).status,'awaiting_approval');
 assert.equal(evaluateStrategy(st,m,held).side,'sell');
 assert.equal(evaluateStrategy(st,m,e).status,'held');
 assert.equal(evaluateStrategy(st,m,{...held,lastFillAt:now}).status,'held');
 const r=evaluateStrategy(st,m,held);const filled=practiceFill(r,st,m,held,true);
 assert.ok(filled.cashCents>held.cashCents);assert.ok((filled.holdingsCents.AAPL??0)<10000);assert.equal(filled.lastFillAt,now);
 assert.equal(evaluateStrategy(st,m,filled).status,'held');
});
test('news_buy waits for a fresh matching headline and honors trade spacing',()=>{
 const st:Strategy={...s,kind:'news_buy',newsKeywords:['earnings beat','upgrade']};
 assert.equal(evaluateStrategy(st,m,e).status,'held');
 const stale={...e,newsItems:[{headline:'AAPL earnings beat expectations',source:'Yahoo Finance',publishedAt:now-NEWS_WINDOW_MS-1000}]};
 assert.equal(evaluateStrategy(st,m,stale).status,'held');
 const fresh={...e,newsItems:[{headline:'Analyst upgrade lifts AAPL',source:'Yahoo Finance',publishedAt:now-3600000}]};
 const r=evaluateStrategy(st,m,fresh);
 assert.equal(r.status,'awaiting_approval');assert.equal(r.side,'buy');
 assert.ok(r.checks.find(c=>c.name==='Strategy trigger')!.detail.includes('Analyst upgrade'));
 assert.equal(evaluateStrategy(st,m,{...fresh,lastFillAt:now}).status,'held');
 assert.equal(evaluateStrategy({...st,mode:'automatic'},m,fresh).status,'ready');
});
test('news_sell requires precise held shares before selling on news',()=>{
 const st:Strategy={...s,kind:'news_sell',newsKeywords:['recall']};
 const fresh={...e,newsItems:[{headline:'Supplier recall reported',source:'Yahoo Finance',publishedAt:now-600000}]};
 assert.equal(evaluateStrategy(st,m,fresh).status,'held');
 const r=evaluateStrategy(st,m,{...fresh,...held,newsItems:fresh.newsItems});
 assert.equal(r.status,'awaiting_approval');assert.equal(r.side,'sell');
 const estimated={...fresh,...held,shareUnitsNanos:undefined,newsItems:fresh.newsItems};
 assert.equal(evaluateStrategy(st,m,estimated).status,'held');
});
test('news keywords and portfolio sizes are strictly validated',()=>{
 const news:Strategy={...s,kind:'news_buy',newsKeywords:['earnings']};
 assert.throws(()=>validateStrategy({...news,newsKeywords:[]}),/one to five/);
 assert.throws(()=>validateStrategy({...news,newsKeywords:['a','b','c','d','e','f']}),/one to five/);
 assert.throws(()=>validateStrategy({...news,newsKeywords:['x'.repeat(41)]}),/1 to 40/);
 assert.throws(()=>validateStrategy({...news,newsKeywords:['earnings','EARNINGS']}),/distinct/);
 assert.throws(()=>validateStrategy({...s,kind:'portfolio',targets:[1,2,3,4,5,6,7].map((n,i)=>({symbol:['AAPL','META','MSFT','NVDA','TSLA','AMZN','GOOGL'][i],targetBps:n*100}))}),/two to six/);
 assert.equal(validateStrategy({...s,kind:'portfolio',targets:[1,2,3,4,5,6].map((n,i)=>({symbol:['AAPL','META','MSFT','NVDA','TSLA','AMZN'][i],targetBps:500}))}).kind,'portfolio');
});
test('matchNewsItems enforces the 24-hour window and keyword matching',()=>{
 const items=[{headline:'Great earnings beat',source:'A',publishedAt:now-1000},{headline:'Old upgrade story',source:'B',publishedAt:now-NEWS_WINDOW_MS-5000},{headline:'Unrelated note',source:'C',publishedAt:now-2000}];
 const matched=matchNewsItems(items,['earnings','UPGRADE'],now);
 assert.equal(matched.length,1);assert.equal(matched[0].headline,'Great earnings beat');
 assert.equal(matchNewsItems(items,['nothing'],now).length,0);
 assert.equal(matchNewsItems([{headline:'Future talk',source:'A',publishedAt:now+3600000}],['future'],now).length,0);
});
