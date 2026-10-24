import test from 'node:test';
import assert from 'node:assert/strict';
import {trailingStop,applyTrailing} from './trailing.ts';
import {validateAutonomousRule,type AutonomousRule} from './autonomous-live.ts';
const strategy={version:1,kind:'sell_below' as const,symbol:'AAPL',direction:'Trailing stop',amountCents:500,reserveCents:0,intervalHours:1,thresholdCents:1,targetBps:5000,driftBps:100,maxMovementBps:100,mode:'automatic' as const};
const rule:AutonomousRule={version:1,symbol:'AAPL',amountCents:500,kind:'sell_below',intervalMinutes:1,thresholdCents:1,trailBps:800,trailSince:'2026-10-24T00:00:00.000Z',strategy};
test('the stop follows the high: 8% under $380 is $349.60',()=>{
 assert.equal(trailingStop(38000,800),34960);
 const live=applyTrailing(rule,38000);
 assert.equal(live.thresholdCents,34960);assert.equal(live.strategy!.thresholdCents,34960);
 assert.doesNotThrow(()=>validateAutonomousRule(live));
});
test('trailing stops are stop-losses with a sane trail and a past start',()=>{
 assert.doesNotThrow(()=>validateAutonomousRule(rule));
 assert.throws(()=>validateAutonomousRule({...rule,trailBps:50}));
 assert.throws(()=>validateAutonomousRule({...rule,kind:'threshold',strategy:undefined}));
 assert.throws(()=>validateAutonomousRule({...rule,trailSince:'2999-01-01T00:00:00.000Z'}));
 assert.throws(()=>trailingStop(0,800));
});
test('only sell rules may check every minute; buys stay at 15 minutes or more',()=>{
 assert.doesNotThrow(()=>validateAutonomousRule({...rule,intervalMinutes:1}));
 assert.throws(()=>validateAutonomousRule({version:1,symbol:'AAPL',amountCents:500,kind:'threshold',intervalMinutes:1,thresholdCents:30000}));
 assert.doesNotThrow(()=>validateAutonomousRule({version:1,symbol:'AAPL',amountCents:500,kind:'threshold',intervalMinutes:15,thresholdCents:30000}));
});
