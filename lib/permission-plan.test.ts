import test from 'node:test';
import assert from 'node:assert/strict';
import { planFromMandate, planSummary, type PlanOutput } from './permission-plan.ts';
import type { Mandate } from './decision.ts';

const now = new Date(1800000000000);
const owner = '0xdc7f175bca1c29a77286a52c857e7fef12f3f662';
const outputs: PlanOutput[] = [
  { symbol: 'AAPL', token: '0x1111111111111111111111111111111111111111' },
  { symbol: 'NVDA', token: '0x2222222222222222222222222222222222222222' },
];
const mandate: Mandate = {
  version: 2, allowedSymbols: ['AAPL', 'NVDA'], maxOrderCents: 500,
  maxDailyBuyCents: 2000, maxPositionBps: 2000, requireApproval: true,
  executionPreference: 'approval',
};

test('mandate compiles to exact raw USDG limits and the two-day window', () => {
  const plan = planFromMandate(mandate, owner, outputs, now);
  assert.ok('perTradeRaw' in plan);
  if (!('perTradeRaw' in plan)) return;
  assert.equal(plan.perTradeRaw, '5000000');   // $5.00 at 6 decimals
  assert.equal(plan.dailyRaw, '20000000');     // $20.00
  assert.equal(plan.totalRaw, '40000000');     // two days of the daily ceiling
  assert.equal(plan.owner, owner);
  assert.equal(plan.chainId, 4663);
  const midnight = now.getTime() - (now.getTime() % 86_400_000);
  assert.equal(plan.expiresAt, midnight + 2 * 86_400_000);
  assert.equal(plan.outputs.length, 2);
  assert.equal(plan.session, 'owner-wallet');
});

test('summary shows the same dollars the policy carries', () => {
  const plan = planFromMandate(mandate, owner, outputs, now);
  if (!('perTradeRaw' in plan)) return assert.fail('plan should compile');
  const summary = planSummary(plan);
  assert.equal(summary.perTrade, '$5.00');
  assert.equal(summary.daily, '$20.00');
  assert.equal(summary.total, '$40.00');
  assert.equal(summary.outputs, 'AAPL, NVDA');
});

test('a symbol without an official token blocks the plan (fail closed)', () => {
  const plan = planFromMandate({ ...mandate, allowedSymbols: ['AAPL', 'FAKE'] }, owner, outputs, now);
  assert.ok('error' in plan);
  if ('error' in plan) assert.match(plan.error, /FAKE/);
});

test('more than three approved symbols is refused (policy compiler cap)', () => {
  const many = { ...mandate, allowedSymbols: ['AAPL', 'NVDA', 'TSLA', 'MSFT'] };
  const plan = planFromMandate(many, owner, [
    ...outputs,
    { symbol: 'TSLA', token: '0x3333333333333333333333333333333333333333' },
    { symbol: 'MSFT', token: '0x4444444444444444444444444444444444444444' },
  ], now);
  assert.ok('error' in plan);
  if ('error' in plan) assert.match(plan.error, /at most 3/);
});

test('no mandate, unverified owner and empty approvals are refused', () => {
  assert.ok('error' in planFromMandate(null, owner, outputs, now));
  assert.ok('error' in planFromMandate({ ...mandate, version: 0 }, owner, outputs, now));
  assert.ok('error' in planFromMandate(mandate, 'not-an-address', outputs, now));
  assert.ok('error' in planFromMandate({ ...mandate, allowedSymbols: [] }, owner, outputs, now));
  assert.ok('error' in planFromMandate({ ...mandate, maxDailyBuyCents: 100, maxOrderCents: 500 }, owner, outputs, now));
});
