import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateLiveStrategy,type LiveAsset,type LiveStrategySnapshot} from './live-strategy.ts';
import {STRATEGY_KINDS,type Strategy} from './strategy.ts';import type {Mandate} from './decision.ts';
const now=Date.parse('2026-10-12T12:00:00Z');
const address=(digit:string)=>('0x'+digit.repeat(40)) as `0x${string}`;
const asset=(symbol:string,token:`0x${string}`,balanceRaw:string,price:string,decimals=18):LiveAsset=>({symbol,token,balanceRaw,reservedRaw:'0',lowerMicroUsd:price,upperMicroUsd:price,shareLowerMicroUsd:price,shareUpperMicroUsd:price,decimals,priceAt:new Date(now).toISOString(),source:'verified fixture bound',halted:false});
const snapshot=():LiveStrategySnapshot=>({account:address('a'),blockHash:('0x'+'b'.repeat(64)) as `0x${string}`,observedAt:new Date(now).toISOString(),inventoryComplete:true,historyComplete:true,assets:[asset('USDG',address('1'),'1000000000','1000000',6),{...asset('AAPL',address('2'),'1000000000000000000','100000000'),previousUpperMicroUsd:'100000000',previousAt:new Date(now-3600000).toISOString()},asset('MSFT',address('3'),'5000000000000000000','100000000')],filledBuyCents:0,pendingBuyCents:0,spendDay:'2026-10-12',lastFillAt:null,maximumFeeMicroUsd:'100000',news:{verified:true,complete:true,observedAt:new Date(now).toISOString(),items:[{id:'news',symbols:['AAPL'],headline:'AAPL announces earnings',source:'trusted fixture feed',publishedAt:new Date(now-1000).toISOString()}]}});
const mandate={version:1,allowedSymbols:['AAPL','MSFT'],maxOrderCents:1000,maxDailyBuyCents:5000,maxPositionBps:9000,executionPreference:'automatic'} as Mandate;
function rule(kind:Strategy['kind']):Strategy{return {version:1,kind,direction:'fixture strategy',symbol:'AAPL',amountCents:1000,reserveCents:2000,intervalHours:1,thresholdCents:11000,sellThresholdCents:12000,targetBps:5000,driftBps:100,maxMovementBps:100,mode:'automatic',newsKeywords:['earnings'],targets:[{symbol:'AAPL',targetBps:2000},{symbol:'MSFT',targetBps:1000}]};}

test('all twelve live strategy kinds produce bounded raw-input plans from canonical evidence',()=>{
 for(const kind of STRATEGY_KINDS){const strategy=rule(kind);if(kind==='sell_threshold')strategy.thresholdCents=9000;if(kind==='rebalance')strategy.targetBps=200;if(kind==='price_band'){strategy.thresholdCents=8000;strategy.sellThresholdCents=9000;}
  const decision=evaluateLiveStrategy(strategy,mandate,snapshot(),now);
  assert.equal(decision.state,'ready',kind+': '+JSON.stringify(decision.checks));
  assert.ok(BigInt(decision.inputRaw!)>0n);assert.ok(BigInt(decision.maximumInputMicroUsd!)<=10000000n);assert.equal(decision.executionEnabled,false);
  const expectedSide=['sell_threshold','sell_below','sell_scheduled','news_sell','rebalance','price_band','portfolio'].includes(kind)?'sell':'buy';
  assert.equal(decision.side,expectedSide,kind);assert.ok(decision.intentDigest);
 }
});

test('live strategy planning blocks stale/unbounded evidence, reserved holdings and missing news',()=>{
 for(const change of [
  (s:LiveStrategySnapshot)=>{s.inventoryComplete=false;},
  (s:LiveStrategySnapshot)=>{s.historyComplete=false;},
  (s:LiveStrategySnapshot)=>{s.observedAt=new Date(now+1).toISOString();},
  (s:LiveStrategySnapshot)=>{s.assets[2].priceAt=new Date(now-31000).toISOString();},
  (s:LiveStrategySnapshot)=>{s.lastFillAt=new Date(now-1000).toISOString();},
  (s:LiveStrategySnapshot)=>{s.pendingBuyCents=5000;},
  (s:LiveStrategySnapshot)=>{s.assets[0].reservedRaw=s.assets[0].balanceRaw;},
  (s:LiveStrategySnapshot)=>{s.assets.push({...s.assets[1]});},
 ]){const evidence=snapshot();change(evidence);assert.equal(evaluateLiveStrategy(rule('scheduled'),mandate,evidence,now).state,'held');}
 for(const kind of ['news_buy','news_sell'] as const){const evidence=snapshot();evidence.news!.verified=false;assert.equal(evaluateLiveStrategy(rule(kind),mandate,evidence,now).state,'held');evidence.news!.verified=true;evidence.news!.items[0].symbols=['MSFT'];assert.equal(evaluateLiveStrategy(rule(kind),mandate,evidence,now).state,'held');}
});

test('sales cannot short, spread uncertainty does not invent allocation triggers, and USDG depegs size down',()=>{
 const sell=snapshot();sell.assets[1].reservedRaw=sell.assets[1].balanceRaw;assert.equal(evaluateLiveStrategy(rule('sell_scheduled'),mandate,sell,now).state,'held');
 const spread=snapshot();spread.assets[1].upperMicroUsd='1000000000';assert.equal(evaluateLiveStrategy(rule('allocation'),mandate,spread,now).state,'held');
 const depeg=snapshot();depeg.assets[0].upperMicroUsd='1100000';const decision=evaluateLiveStrategy(rule('scheduled'),mandate,depeg,now);assert.equal(decision.state,'ready');assert.equal(decision.inputRaw,'9090909');assert.ok(BigInt(decision.maximumInputMicroUsd!)<=10000000n);
 const changed=snapshot();changed.assets[0].balanceRaw='999999999';assert.notEqual(evaluateLiveStrategy(rule('scheduled'),mandate,changed,now).intentDigest,decision.intentDigest);
});



test('price triggers use underlying share prices while sizing uses token value',()=>{
 const e=snapshot();e.assets[1].lowerMicroUsd='200000000';e.assets[1].upperMicroUsd='200000000';
 const buy=evaluateLiveStrategy(rule('threshold'),mandate,e,now);
 assert.equal(buy.state,'ready');
 const sellRule={...rule('sell_threshold'),thresholdCents:15000};
 assert.equal(evaluateLiveStrategy(sellRule,mandate,e,now).state,'held');
 delete e.assets[1].shareLowerMicroUsd;
 assert.equal(evaluateLiveStrategy(rule('threshold'),mandate,e,now).state,'held');
});

test('accumulation compares a prior interval sample within one scheduler period, never recent or unbounded history',()=>{
 for(const [age,expected] of [[3600000,'ready'],[3600000+899000,'ready'],[3599000,'held'],[4500001,'held']] as const){const e=snapshot();e.assets[1].previousAt=new Date(now-age).toISOString();assert.equal(evaluateLiveStrategy(rule('accumulate'),mandate,e,now).state,expected);}
});
