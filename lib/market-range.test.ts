import assert from 'node:assert/strict';
import test from 'node:test';
import {selectMarketRange} from './market-range.ts';
import type {MarketSample} from './market-chart.ts';

const sample=(hour:number,bidCents:number):MarketSample=>({symbol:'AAPL',observedAt:new Date(Date.UTC(2026,9,16,hour)).toISOString(),bidCents,askCents:bidCents+4});

test('ends a short range at the last change instead of filling it with stale checks',()=>{
 const range=selectMarketRange([sample(8,10000),sample(9,10100),sample(10,10100),sample(11,10200),sample(12,10200),sample(17,10200),sample(20,10200)],4*60*60_000);
 assert.equal(range.anchorAt,sample(11,10200).observedAt);
 assert.equal(range.lastCheckedAt,sample(20,10200).observedAt);
 assert.deepEqual(range.changes.map(point=>point.bidCents),[10000,10100,10200]);
 assert.equal(range.observations.length,4);
});

test('a genuinely unchanged range stays a single-price state',()=>{
 const range=selectMarketRange([sample(8,10000),sample(9,10000),sample(10,10000)],4*60*60_000);
 assert.equal(range.observations.length,3);
 assert.deepEqual(range.changes.map(point=>point.bidCents),[10000]);
 assert.equal(range.anchorAt,sample(10,10000).observedAt);
});

test('handles missing samples',()=>{
 assert.deepEqual(selectMarketRange([],4*60*60_000),{observations:[],changes:[],anchorAt:null,lastCheckedAt:null});
});
