import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePracticeMarketQuote,fetchPracticeMarketQuote} from './practice-market.ts';

const now=Date.UTC(2026,8,30,14);
const quote=(changes:Record<string,unknown>={})=>({quotes:[{tokenSymbol:'AAPL',deployments:[{chainId:4663}],bid:'180.00',ask:'180.01',currency:'USD',isTradingHalt:false,generatedAt:new Date(now-15000).toISOString(),...changes}]});
test('uses a fresh official ask and rejects unusable market evidence',()=>{
 assert.equal(parsePracticeMarketQuote(quote(),'AAPL',now)?.priceCents,18001);
 assert.equal(parsePracticeMarketQuote(quote(),'AAPL',now)?.bidCents,18000);
 assert.equal(parsePracticeMarketQuote(quote({generatedAt:new Date(now-61000).toISOString()}),'AAPL',now),null);
 assert.equal(parsePracticeMarketQuote(quote({isTradingHalt:true}),'AAPL',now),null);
 assert.equal(parsePracticeMarketQuote(quote({ask:'179.99'}),'AAPL',now),null);
 assert.equal(parsePracticeMarketQuote(quote({deployments:[{chainId:1}]}),'AAPL',now),null);
});
test('network failure blocks the live quote rather than falling back to a fixture',async()=>{
 const unavailable=await fetchPracticeMarketQuote('AAPL',now,async()=>{throw Error('offline');});
 assert.equal(unavailable,null);
});
