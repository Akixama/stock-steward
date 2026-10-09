import test from 'node:test';
import assert from 'node:assert/strict';
import {newPracticeSession} from './practice-session.ts';
import {realPricePractice} from './practice-market-mode.ts';
test('conversion keeps saved fake funds and holdings but removes fixture authority and quote freshness',()=>{
 const old=newPracticeSession();old.account.cashCents=99600;old.account.holdingsCents={AAPL:399};old.account.grant=true;old.running=true;old.background=true;old.permissionExpiresAt=Date.now()+10000;
 const next=realPricePractice(old);
 assert.equal(next.priceSource,'market');assert.equal(next.account.cashCents,99600);assert.deepEqual(next.account.holdingsCents,{AAPL:399});assert.equal(next.account.grant,false);assert.equal(next.running,false);assert.equal(next.background,false);assert.equal(next.account.quoteAt,0);assert.equal(next.feedAvailable,false);assert.equal(old.account.grant,true);assert.equal(realPricePractice(next),next);
});
