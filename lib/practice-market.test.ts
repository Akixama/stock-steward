import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePracticeMarketQuote,fetchPracticeMarketQuote,parsePracticeNewsFeed} from './practice-market.ts';

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


test('news feed parsing extracts clean headlines and rejects junk',()=>{
 const now=Date.UTC(2026,9,6,12);
 const xml='<rss><channel><item><title>Analyst upgrade lifts &amp;lt;AAPL&amp;gt;</title><pubDate>Mon, 06 Oct 2026 11:00:00 GMT</pubDate><source>Yahoo Finance</source></item><item><title>No date story</title></item><item><title>Future story</title><pubDate>Wed, 06 Oct 2027 11:00:00 GMT</pubDate></item></channel></rss>';
 const items=parsePracticeNewsFeed(xml,now);
 assert.equal(items.length,1);assert.equal(items[0].headline,'Analyst upgrade lifts <AAPL>');assert.equal(items[0].source,'Yahoo Finance');assert.equal(items[0].publishedAt,Date.parse('Mon, 06 Oct 2026 11:00:00 GMT'));
 assert.deepEqual(parsePracticeNewsFeed('not an rss feed',now),[]);
 assert.deepEqual(parsePracticeNewsFeed('<item></item>',now),[]);
});