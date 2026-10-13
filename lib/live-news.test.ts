import test from 'node:test';import assert from 'node:assert/strict';import {readLiveNews} from './live-news.ts';
const now=Date.parse('2026-10-12T12:00:00Z'),config={enabled:true,realTimeAccessVerified:true,commercialUseVerified:true,keyId:'fixture-key',secretKey:'fixture-secret'};
const item={id:1,headline:'AAPL earnings announcement',symbols:['AAPL'],source:'fixture',created_at:new Date(now-1000).toISOString(),updated_at:new Date(now-1000).toISOString()};
const response=(body:unknown)=>Response.json(body,{headers:{date:new Date(now).toUTCString()}});
test('news credentials stay in headers and full pagination is required',async()=>{
 let calls=0;const fetcher=(async(url,init)=>{calls++;assert.equal(new URL(String(url)).origin,'https://data.alpaca.markets');assert.ok(!String(url).includes(config.secretKey));assert.equal((init?.headers as Record<string,string>)['APCA-API-SECRET-KEY'],config.secretKey);assert.equal(init?.redirect,'error');return response({news:[item],next_page_token:calls===1?'next':null});}) as typeof fetch;
 const result=await readLiveNews(['AAPL'],config,fetcher,now);assert.equal(result.state,'ready');assert.equal(calls,2);assert.equal(result.news.items.length,1);
});
test('news stays blocked without entitlement, on stale/future evidence or looping pages',async()=>{
 let calls=0;const unused=(async()=>{calls++;throw Error('must not call');}) as typeof fetch;
 for(const change of [{enabled:false},{realTimeAccessVerified:false},{commercialUseVerified:false},{keyId:''}])assert.equal((await readLiveNews(['AAPL'],{...config,...change},unused,now)).state,'blocked');assert.equal(calls,0);
 for(const fetcher of [(async()=>response({news:[{...item,created_at:new Date(now+1).toISOString()}]})),(async()=>response({news:[item],next_page_token:'loop'})),(async()=>Response.json({news:[item]})),(async()=>response({news:null}))]){
  const result=await readLiveNews(['AAPL'],config,fetcher as typeof fetch,now);assert.equal(result.state,'blocked');assert.deepEqual(result.news.items,[]);
 }
});
