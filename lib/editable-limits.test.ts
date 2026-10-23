import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { editableLimitsValid, MAX_EDITABLE_LIMIT_CENTS, NEW_USER_MANDATE } from './editable-limits.ts';
import { mandateSaveSchema, parseMandateSaveRequest } from './mandate-save-schema.ts';
import { planFromMandate } from './permission-plan.ts';

const body = (order: number, daily: number) => ({ baseVersion: 0, allowedSymbols: ['AAPL'],
  maxOrderCents: order, maxDailyBuyCents: daily, maxPositionBps: 1500, executionPreference: 'approval' });

test('new users retain the $100 buy and $250 daily unsaved defaults', () => {
  assert.equal(NEW_USER_MANDATE.version, 0);
  assert.equal(NEW_USER_MANDATE.maxOrderCents, 10_000);
  assert.equal(NEW_USER_MANDATE.maxDailyBuyCents, 25_000);
  assert.deepEqual(NEW_USER_MANDATE.allowedSymbols, []);
});

test('the Limits form uses the shared $10,000 maximum for both editable amounts', () => {
  assert.equal(MAX_EDITABLE_LIMIT_CENTS, 1_000_000);
  assert.equal(editableLimitsValid(1_000_000, 1_000_000), true);
  assert.equal(editableLimitsValid(1_000_001, 1_000_001), false);
  assert.equal(editableLimitsValid(500, 499), false);
  const source = readFileSync(new URL('../app/workspace/workspace-client.tsx', import.meta.url), 'utf8');
  assert.equal((source.match(/max=\{MAX_EDITABLE_LIMIT_CENTS\/100\}/g) ?? []).length, 2);
});

test('a direct PUT-shaped request over the maximum is rejected before storage', async () => {
  const request = new Request('https://stocksteward.app/api/workspace/mandate', { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body(1_000_001, 1_000_001)) });
  assert.equal((await parseMandateSaveRequest(request))?.success, false);
  assert.equal(mandateSaveSchema.safeParse(body(1_000_000, 1_000_000)).success, true);
  assert.equal(mandateSaveSchema.safeParse(body(1_000_000, 999_999)).success, false);
});

test('an existing saved policy above the edit ceiling remains usable until its owner edits it', () => {
  const existing = { ...NEW_USER_MANDATE, version: 3, allowedSymbols: ['AAPL'],
    maxOrderCents: 2_000_000, maxDailyBuyCents: 2_000_000 };
  const plan = planFromMandate(existing, '0x' + 'a'.repeat(40), [{ symbol: 'AAPL', token: '0x' + 'b'.repeat(40) }], new Date('2026-10-23T10:00:00Z'));
  assert.ok('totalRaw' in plan);
  if ('totalRaw' in plan) assert.equal(plan.totalRaw, '40000000000');
  assert.equal(mandateSaveSchema.safeParse({ ...body(2_000_000, 2_000_000), baseVersion: 3 }).success, false);
  assert.equal(mandateSaveSchema.safeParse({ ...body(1_000_000, 1_000_000), baseVersion: 3 }).success, true);
});
