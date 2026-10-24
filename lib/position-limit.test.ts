import test from 'node:test';
import assert from 'node:assert/strict';
import {positionLimitCheck,POSITION_CHECK_MAX_AGE_MS} from './position-limit.ts';
import type {PricedObservation} from './chain-analysis.ts';

const SAFE='0x7d3a9c2b5e41f0a8c6d2e9b1f4a7c3e5d8b2a6f1',NOW=Date.parse('2026-10-24T12:00:00Z');
const PRICES={AAPL:['347.17','347.19'],MSFT:['524.12','524.22'],NVDA:['212.00','212.01']} as const;
// A saved value check: USDG plus stock holdings given in dollars at the midpoint.
function check(usdg:string,stocks:Partial<Record<keyof typeof PRICES,number>>,ageMs=60_000,extra:Partial<PricedObservation>={}):PricedObservation{
 const holdings=[],prices:PricedObservation['prices']={};let subtotal=0;
 for(const [symbol,dollars] of Object.entries(stocks) as [keyof typeof PRICES,number][]){const contract='0x'+symbol.toLowerCase().padEnd(40,'0');const [bid,ask]=PRICES[symbol];const mid=(Number(bid)+Number(ask))/2;
  holdings.push({symbol,contract,raw:'0x1',decimals:18,quantity:(dollars/mid).toFixed(8),status:'active',multiplier:'1'});
  prices[contract]={state:'fresh',generatedAt:null,bid,ask,multiplier:'1',tokenMid18:null,valueMicroUsd:String(Math.round(dollars*1e6)),reason:''};subtotal+=Math.round(dollars*1e6);}
 return {id:'c',address:SAFE,chainId:4663,block:'0x1',observedAt:new Date(NOW-ageMs).toISOString(),eth:'0',usdg,scanned:195,holdings,failures:0,source:'test',prices,subtotalMicroUsd:String(subtotal),valuationComplete:true,pricedCount:holdings.length,policyVersion:2,alerts:[],executionReady:false,...extra};
}
const run=(observation:PricedObservation|null,over:Partial<Parameters<typeof positionLimitCheck>[0]>={})=>positionLimitCheck({observation,safe:SAFE,symbol:'MSFT',buyCents:1000,maxPositionBps:4000,buysSinceCents:0,outflowSinceCheck:false,now:NOW,...over});

test('a buy that stays under the limit passes and reports the share',()=>{
 const result=run(check('41.6',{AAPL:20,MSFT:20,NVDA:10}));
 assert.equal(result.ok,true);
 assert.ok(result.shareBps>3270&&result.shareBps<3290,String(result.shareBps)); // about 32.8% after the buy
});
test('a buy that pushes one stock over the limit is refused with the reason',()=>{
 const result=run(check('50',{}),{maxPositionBps:1495});
 assert.equal(result.ok,false);
 assert.equal(result.ok===false&&result.reason,'over');
 assert.match(result.ok===false?result.error:'',/would put 20\.\d% of your Steward wallet in MSFT\. Your limit is 14\.95%.*Nothing was sent/);
});
test('the slippage allowance is counted: $67.30 fits a $10 buy at 14.95%, $66.89 does not',()=>{
 assert.equal(run(check('67.30',{}),{maxPositionBps:1495}).ok,true);
 assert.equal(run(check('66.89',{}),{maxPositionBps:1495}).ok,false);
});
test('stock already held and buys made after the check both count toward the share',()=>{
 assert.equal(run(check('100',{}),{maxPositionBps:1495}).ok,true);
 assert.equal(run(check('90',{MSFT:10}),{maxPositionBps:1495}).ok,false);
 assert.equal(run(check('100',{}),{maxPositionBps:1495,buysSinceCents:1000}).ok,false);
 // Other stocks count toward the total, not the share.
 assert.equal(run(check('40',{AAPL:30,NVDA:30}),{maxPositionBps:1495}).ok,true);
});
test('anything stale, incomplete or for another wallet refuses instead of passing',()=>{
 const fresh=check('500',{});
 for(const [label,result] of [
  ['no check',run(null)],
  ['too old',run(check('500',{},POSITION_CHECK_MAX_AGE_MS+1000))],
  ['from the future',run(check('500',{},-60_000))],
  ['another wallet',run({...fresh,address:'0x'+'9'.repeat(40)})],
  ['sale or send since',run(fresh,{outflowSinceCheck:true})],
  ['incomplete valuation',run({...fresh,valuationComplete:false})],
  ['failed reads',run({...fresh,failures:2})],
  ['unknown USDG',run({...fresh,usdg:null})],
  ['missing price',run(check('500',{AAPL:10},60_000,{prices:{}}))],
  ['bad limit',run(fresh,{maxPositionBps:0})],
 ] as const){assert.equal(result.ok,false,label);assert.equal(result.ok===false&&result.reason,'stale',label);assert.match(result.ok===false?result.error:'',/refresh your wallet value/,label);}
});
test('a 100% limit allows any buy the wallet can cover',()=>{
 assert.equal(run(check('10.10',{}),{maxPositionBps:10_000}).ok,true);
});
