import test from 'node:test';import assert from 'node:assert/strict';import {newPracticeSession,transitionPractice,type PracticeSession} from './practice-session.ts';import type {Strategy} from './strategy.ts';import type {Mandate} from './decision.ts';
const now=Date.UTC(2026,8,28,12);const m={version:1,allowedSymbols:['AAPL'],maxOrderCents:200,maxDailyBuyCents:200,maxPositionBps:2000,requireApproval:true} as Mandate;
const strategy:Strategy={version:1,kind:'scheduled',direction:'Buy $1 daily',symbol:'AAPL',amountCents:100,reserveCents:2000,intervalHours:24,thresholdCents:18000,targetBps:1000,driftBps:200,maxMovementBps:500,mode:'approval'};
const act=(s:PracticeSession,action:Parameters<typeof transitionPractice>[2],at=now,mandate=m)=>transitionPractice(s,mandate,action,at);
function ready(mode:Strategy['mode']='approval'){let s=act(newPracticeSession(now),{action:'confirm',strategy:{...strategy,mode}});return act(s,{action:'authorize'});}
test('exact approval changes 1000 to 999 once and cannot be replayed',()=>{let s=act(ready(),{action:'run'});assert.equal(s.account.cashCents,100000);const id=s.receipts[0].id;s=act(s,{action:'approve',id},now+1000);assert.equal(s.account.cashCents,99900);assert.equal(s.account.holdingsCents.AAPL,100);assert.throws(()=>act(s,{action:'approve',id}));});
test('price, clock, replacement, revocation and expiry invalidate pending approval',()=>{for(const command of [{action:'price',symbol:'AAPL',priceCents:18100},{action:'advance'},{action:'confirm',strategy},{action:'revoke'}] as const){const before=act(ready(),{action:'run'});const id=before.receipts[0].id;const next=act(before,command);assert.throws(()=>act(next,{action:'approve',id}));assert.equal(next.account.cashCents,100000);}const expired=act(act(ready(),{action:'run'}),{action:'refresh'},now+60000);assert.equal(expired.receipts[0].outcome,'held');assert.equal(expired.account.cashCents,100000);});
test('automatic background runs respect interval and daily reset',()=>{let s=ready('automatic');s=act(s,{action:'start'});s=act(s,{action:'background',enabled:true});s=transitionPractice(s,m,{action:'run'},now,'background');assert.equal(s.account.cashCents,99900);s=act(s,{action:'run'},now+900000);assert.equal(s.receipts[0].outcome,'held');assert.equal(s.account.cashCents,99900);s=act(s,{action:'run'},now+86400000);assert.equal(s.account.grant,false);assert.equal(s.account.cashCents,99900);s=act(s,{action:'authorize'},now+86400000);s=act(s,{action:'run'},now+86400000+9000);assert.equal(s.account.cashCents,99800);assert.equal(s.account.spentCents,100);});
test('safeguard scenarios hold funds and reset requires revocation',()=>{for(const scenario of ['stale','cash','daily','concentration'] as const){let s=ready('automatic');s=act(s,{action:'scenario',scenario});const cash=s.account.cashCents;s=act(s,{action:'run'});assert.equal(s.receipts[0].outcome,'held');assert.equal(s.account.cashCents,cash);}assert.throws(()=>act(ready(),{action:'reset'}));const reset=act(act(ready(),{action:'revoke'}),{action:'reset'});assert.equal(reset.account.cashCents,100000);assert.equal(reset.account.grant,false);});
test('mandate changes revoke permission and stop background execution',()=>{let s=act(act(ready(),{action:'start'}),{action:'background',enabled:true});s=act(s,{action:'refresh'},now,{...m,version:2});assert.equal(s.background,false);assert.equal(s.running,false);assert.equal(s.account.grant,false);});

test('changing a safeguard scenario permits an immediate fresh check without bypassing its limit',()=>{let s=act(ready('automatic'),{action:'run'});for(const scenario of ['stale','cash','daily','concentration'] as const){s=act(s,{action:'scenario',scenario},now+1000);const count=s.receipts.length,cash=s.account.cashCents;s=act(s,{action:'run'},now+1000);assert.equal(s.receipts.length,count+1);assert.equal(s.receipts[0].outcome,'held');assert.equal(s.account.cashCents,cash);}assert.equal(s.running,false);assert.equal(s.background,false);});
test('a fresh practice session has no authority and needs confirmed rules and saved limits',()=>{const s=newPracticeSession(now);assert.equal(s.account.cashCents,100000);assert.deepEqual(s.account.holdingsCents,{});assert.equal(s.account.grant,false);assert.equal(s.strategy,null);assert.throws(()=>act(s,{action:'authorize'}));assert.throws(()=>act(act(s,{action:'confirm',strategy}),{action:'authorize'},now,{...m,version:0}));});
test('live quote practice uses real quote time, holds on outages and cannot use fixture controls',()=>{
 let s=act(newPracticeSession(now),{action:'confirm',strategy:{...strategy,mode:'automatic'}});
 s=act(s,{action:'price_source',source:'market'});
 assert.equal(s.account.cashCents,100000);
 assert.throws(()=>act(s,{action:'advance'}));
 s=act(s,{action:'authorize'});
 s=act(s,{action:'market_quote',quote:null});
 s=act(s,{action:'run'});
 assert.equal(s.receipts[0].outcome,'held');assert.equal(s.account.cashCents,100000);
 const at=now+9000;
 s=act(s,{action:'market_quote',quote:{symbol:'AAPL',priceCents:18001,generatedAt:at-1000,source:'Robinhood underlying-equity ask'}},at);
 s=act(s,{action:'run'},at);
 assert.equal(s.receipts[0].outcome,'simulated_fill');assert.equal(s.account.cashCents,99900);
 assert.equal(s.account.quoteAt,at-1000);
 assert.throws(()=>act(s,{action:'price',symbol:'AAPL',priceCents:19000},at));
});
test('a long automatic run keeps purchase receipts while bounding repetitive holds',()=>{
 let s=ready('automatic');
 for(let i=0;i<130;i++)s=act(s,{action:'run'},now+i*8000);
 assert.equal(s.account.cashCents,99900);
 assert.equal(s.receipts.filter(r=>r.outcome==='simulated_fill').length,1);
 assert.equal(s.receipts.filter(r=>r.outcome==='held').length,40);
 assert.equal(s.receipts.length,41);
});
test('a reviewed practice sale needs exact approval and stays in the trail',()=>{
 let s=ready('automatic');s=act(s,{action:'run'});
 assert.equal(s.account.cashCents,99900);
 s=act(s,{action:'confirm',strategy:{...strategy,kind:'sell_threshold',thresholdCents:18000,intervalHours:1,mode:'approval'}},now+1000);
 assert.equal(s.account.grant,false);assert.equal(s.account.holdingsCents.AAPL,100);
 s=act(s,{action:'authorize'},now+1000);
 s=act(s,{action:'run'},now+3600000);
 const pending=s.receipts[0];assert.equal(pending.side,'sell');assert.equal(pending.outcome,'awaiting_approval');
 assert.equal(s.account.cashCents,99900);
 s=act(s,{action:'approve',id:pending.id},now+3600000+1000);
 assert.equal(s.account.cashCents,100000);assert.equal(s.account.holdingsCents.AAPL,0);
 assert.equal(s.receipts[0].outcome,'simulated_fill');assert.equal(s.receipts[0].side,'sell');
 assert.throws(()=>act(s,{action:'approve',id:pending.id},now+3600000+2000));
});
test('fixture overweight scenario has precise shares for a rebalancing sale',()=>{
 let s=act(newPracticeSession(now),{action:'confirm',strategy:{...strategy,kind:'rebalance',targetBps:1000,driftBps:200,intervalHours:1,mode:'automatic'}});
 s=act(s,{action:'authorize'});s=act(s,{action:'scenario',scenario:'concentration'});
 assert.equal(s.account.valuationEstimated,false);assert.ok(s.account.shareUnitsNanos?.AAPL);
 s=act(s,{action:'run'});
 assert.equal(s.receipts[0].side,'sell');assert.equal(s.receipts[0].outcome,'simulated_fill');
 assert.equal(s.account.cashCents,100100);assert.equal(s.account.holdingsCents.AAPL,999900);
});
test('portfolio live checks hold on one missing quote and trade after both quotes arrive',()=>{
 const mandate={...m,allowedSymbols:['AAPL','META']};
 const portfolio:Strategy={...strategy,kind:'portfolio',targets:[{symbol:'AAPL',targetBps:1000},{symbol:'META',targetBps:1500}],mode:'automatic'};
 let s=act(newPracticeSession(now),{action:'confirm',strategy:portfolio},now,mandate);
 s=act(s,{action:'price_source',source:'market'},now,mandate);
 s=act(s,{action:'authorize'},now,mandate);
 s=act(s,{action:'market_quotes',quotes:[{symbol:'AAPL',priceCents:18001,bidCents:18000,generatedAt:now,source:'Robinhood underlying-equity ask'},null]},now,mandate);
 s=act(s,{action:'run'},now,mandate);assert.equal(s.receipts[0].outcome,'held');
 const at=now+9000;
 s=act(s,{action:'market_quotes',quotes:[{symbol:'AAPL',priceCents:18001,bidCents:18000,generatedAt:at,source:'Robinhood underlying-equity ask'},{symbol:'META',priceCents:50001,bidCents:50000,generatedAt:at,source:'Robinhood underlying-equity ask'}]},at,mandate);
 s=act(s,{action:'run'},at,mandate);assert.equal(s.receipts[0].outcome,'simulated_fill');assert.equal(s.receipts[0].symbol,'META');
 assert.equal(s.account.cashCents,99900);assert.equal(s.account.quoteAtBySymbol?.META,at);
});
test('portfolio confirmation respects approved symbols, concentration and existing holdings',()=>{
 const portfolio:Strategy={...strategy,kind:'portfolio',targets:[{symbol:'AAPL',targetBps:1000},{symbol:'META',targetBps:1500}]};
 assert.throws(()=>act(newPracticeSession(now),{action:'confirm',strategy:portfolio}));
 const mandate={...m,allowedSymbols:['AAPL','META'],maxPositionBps:1000};
 assert.throws(()=>act(newPracticeSession(now),{action:'confirm',strategy:portfolio},now,mandate));
 const allowed={...mandate,maxPositionBps:2000};
 let session=act(newPracticeSession(now),{action:'confirm',strategy:{...strategy,symbol:'AAPL',mode:'automatic'}},now,allowed);
 session=act(session,{action:'authorize'},now,allowed);session=act(session,{action:'run'},now,allowed);
 assert.throws(()=>act(session,{action:'confirm',strategy:{...portfolio,targets:[{symbol:'META',targetBps:1000},{symbol:'MSFT',targetBps:1000}]}},now,{...allowed,allowedSymbols:['AAPL','META','MSFT']}));
});
