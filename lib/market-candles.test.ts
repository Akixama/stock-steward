import test from 'node:test';
import assert from 'node:assert/strict';
import {sampledCandles} from './market-candles.ts';
import type {MarketSample} from './market-chart.ts';

test('candles use only observed bids for open, high, low and close',()=>{
 const base=Date.parse('2026-10-15T10:00:00.000Z');
 const sample=(minute:number,bidCents:number):MarketSample=>({symbol:'AAPL',observedAt:new Date(base+minute*60_000).toISOString(),bidCents,askCents:bidCents+2});
 const {candles,intervalMs}=sampledCandles([sample(3,10100),sample(0,10000),sample(1,10200),sample(2,9900)]);
 assert.equal(intervalMs,2*60_000);
 assert.deepEqual(candles.map(candle=>[candle.openCents,candle.highCents,candle.lowCents,candle.closeCents,candle.observations]),[[10000,10200,10000,10200,2],[9900,10100,9900,10100,2]]);
});

test('one observation remains a single-price doji; empty and invalid inputs do not invent history',()=>{
 const one:MarketSample={symbol:'AAPL',observedAt:'2026-10-15T10:00:00.000Z',bidCents:10000,askCents:10002};
 assert.deepEqual(sampledCandles([one]).candles.map(c=>[c.openCents,c.highCents,c.lowCents,c.closeCents]),[[10000,10000,10000,10000]]);
 assert.deepEqual(sampledCandles([{...one,bidCents:0}]).candles,[]);
 assert.deepEqual(sampledCandles([]).candles,[]);
});
