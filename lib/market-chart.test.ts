import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {latestMarketSamples,marketHistory,sampleMarket} from './market-chart.ts';

test('chart history contains only actual recorded Robinhood bid observations',async()=>{
 const sql=new DatabaseSync(':memory:');
 try{
  sql.exec(readFileSync(new URL('../drizzle/0032_market_price_samples.sql',import.meta.url),'utf8'));
  const db={prepare(query:string){let values:unknown[]=[];const statement={bind(...args:unknown[]){values=args;return statement;},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values as never[]).changes)}};},async all(){return {results:sql.prepare(query).all(...values as never[])}}};return statement;}} as unknown as D1Database;
  const now=Date.now();
  const fetcher=(async()=>Response.json({quotes:[{tokenSymbol:'AAPL',deployments:[{chainId:4663}],bid:'214.21',ask:'214.24',currency:'USD',isTradingHalt:false,generatedAt:new Date(now).toISOString()}]})) as typeof fetch;
  const first=await sampleMarket(db,'AAPL',now,fetcher);
  await sampleMarket(db,'AAPL',now,fetcher);
  assert.equal(first?.bidCents,21421);
  assert.equal(first?.askCents,21424);
  assert.deepEqual(await marketHistory(db,'AAPL'),[first]);
  assert.deepEqual(await marketHistory(db,'MSFT'),[]);
  assert.deepEqual(await latestMarketSamples(db,['AAPL','MSFT']),{AAPL:first});
 }finally{sql.close();}
});
