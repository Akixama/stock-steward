import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateGuard,freshGuard,coolingUntil,validGuardSettings,DEFAULT_GUARD} from './panic-guard.ts';
const $=(d:number)=>BigInt(Math.round(d*100))*10_000n;
const t0=new Date('2026-10-24T12:00:00Z');

test('tracks the high, and trips at the chosen drop from that high',()=>{
 let s=freshGuard('g');
 let r=evaluateGuard(DEFAULT_GUARD,s,$(100),t0);assert.equal(r.tripped,false);s=r.state;
 r=evaluateGuard(DEFAULT_GUARD,s,$(120),t0);assert.equal(r.state.peakMicro,$(120).toString());s=r.state;
 r=evaluateGuard(DEFAULT_GUARD,s,$(109),t0);assert.equal(r.tripped,false,'9.2% under the high');s=r.state;
 r=evaluateGuard(DEFAULT_GUARD,s,$(108),t0);assert.equal(r.tripped,true,'10% under the high');
 assert.match(r.why!,/fell 10\.0% from its high of \$120\.00/);
 assert.equal(r.state.resumeAfter,'2026-10-25T12:00:00.000Z');
});
test('an optional dollar loss limit trips from the starting value',()=>{
 const settings={...DEFAULT_GUARD,dropBps:2000,lossCents:1500};
 let r=evaluateGuard(settings,freshGuard('g'),$(200),t0);
 r=evaluateGuard(settings,r.state,$(186),t0);assert.equal(r.tripped,false);
 r=evaluateGuard(settings,r.state,$(185),t0);assert.equal(r.tripped,true);assert.match(r.why!,/down \$15\.00/);
});
test('during the cool-off nothing re-trips and resume is refused until it ends',()=>{
 let r=evaluateGuard(DEFAULT_GUARD,freshGuard('g'),$(100),t0);
 r=evaluateGuard(DEFAULT_GUARD,r.state,$(80),t0);assert.equal(r.tripped,true);
 const later=new Date(t0.getTime()+3_600_000);
 const again=evaluateGuard(DEFAULT_GUARD,r.state,$(70),later);assert.equal(again.tripped,false);
 assert.equal(coolingUntil(r.state,later.getTime()),r.state.resumeAfter);
 assert.equal(coolingUntil(r.state,t0.getTime()+25*3_600_000),null);
});
test('settings are limited to sensible choices',()=>{
 assert.deepEqual(validGuardSettings({dropBps:500,cooloffHours:72,lossCents:null}),{dropBps:500,cooloffHours:72,lossCents:null});
 assert.throws(()=>validGuardSettings({dropBps:300,cooloffHours:24}));
 assert.throws(()=>validGuardSettings({dropBps:1000,cooloffHours:1}));
 assert.throws(()=>validGuardSettings({dropBps:1000,cooloffHours:24,lossCents:50}));
});
