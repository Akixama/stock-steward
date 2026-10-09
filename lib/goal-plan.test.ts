import test from 'node:test';import assert from 'node:assert/strict';import {goalGuidance,goalProgress,validateGoal,type GoalPlan} from './goal-plan.ts';
const plan:GoalPlan={name:'Home deposit',targetCents:500000,currentCents:100000,monthlyCents:20000,months:12,comfort:'cautious',startedAt:'2026-01-15T00:00:00.000Z'};
test('month-end starts use the last day of shorter months and preserve the start time',()=>{const p={...plan,startedAt:'2026-01-31T12:00:00Z'};assert.equal(goalProgress(p,Date.parse('2026-02-28T11:59:59Z')).remainingMonths,12);assert.equal(goalProgress(p,Date.parse('2026-02-28T12:00:00Z')).remainingMonths,11);assert.equal(goalProgress(p,Date.parse('2026-03-30T12:00:00Z')).remainingMonths,11);assert.equal(goalProgress(p,Date.parse('2026-03-31T12:00:00Z')).remainingMonths,10);});
test('contribution-only plan calculates a gap and rounds needed contribution up',()=>{const p=goalProgress(plan,Date.parse(plan.startedAt));assert.equal(p.projectedCents,340000);assert.equal(p.shortfallCents,160000);assert.equal(p.requiredMonthlyCents,33334);assert.equal(p.percent,20);});
test('elapsed months reduce remaining time without pretending contributions were made',()=>{const p=goalProgress(plan,Date.parse('2026-03-15T00:00:00Z'));assert.equal(p.remainingMonths,10);assert.equal(p.projectedCents,300000);assert.equal(p.percent,20);assert.equal(goalProgress(plan,Date.parse('2026-03-14T00:00:00Z')).remainingMonths,11);});
test('completed targets, zero contribution and expired timeframes stay finite and explicit',()=>{assert.equal(goalProgress({...plan,currentCents:600000},Date.parse(plan.startedAt)).percent,100);assert.equal(goalProgress({...plan,monthlyCents:0},Date.parse(plan.startedAt)).shortfallCents,400000);const p=goalProgress(plan,Date.parse('2028-01-01T00:00:00Z'));assert.equal(p.remainingMonths,0);assert.equal(p.requiredMonthlyCents,null);assert.equal(p.projectedCents,100000);});
test('invalid amounts, timeframes and preferences cannot become saved goals',()=>{for(const patch of [{targetCents:0},{currentCents:-1},{monthlyCents:1.1},{months:0},{months:601},{comfort:'anything'},{name:' '},{startedAt:'invalid'}])assert.throws(()=>validateGoal({...plan,...patch}));assert.equal(validateGoal({...plan,name:' Home '}).name,'Home');});


test('comfort guidance adapts to progress without touching trade limits',()=>{
 const plan:GoalPlan={name:'Home deposit',targetCents:500000,currentCents:100000,monthlyCents:30000,months:12,comfort:'cautious',startedAt:'2026-10-06T12:00:00Z'};
 const progress=goalProgress(plan,Date.parse('2026-10-06T12:00:00Z'));
 const cautious=goalGuidance(plan,progress);
 assert.ok(cautious.points.some(p=>p.text.includes('gap')));
 assert.ok(cautious.points.some(p=>/scheduled buys|price-ceiling/.test(p.text+p.detail)));
 const balanced=goalGuidance({...plan,comfort:'balanced'},progress);
 assert.ok(balanced.points.some(p=>/Dollar-cost|accumulation/.test(p.text+p.detail)));
 const donePlan={...plan,currentCents:500000};const reached=goalGuidance(donePlan,goalProgress(donePlan,Date.parse('2026-10-06T12:00:00Z')));
 assert.ok(reached.points[0].text.includes('meet this target'));
 const expired=goalGuidance(plan,goalProgress(plan,Date.parse('2028-10-06T12:00:00Z')));
 assert.ok(expired.points[0].text.includes('timeframe has ended'));
});