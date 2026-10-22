import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { publicTradingVars } from '../scripts/public-trading-release.mjs';

test('public release is off by default with high app-wide caps and US IP block', () => {
  const release = JSON.parse(fs.readFileSync('config/public-trading-release.json', 'utf8'));
  assert.deepEqual(publicTradingVars(release), {
    PUBLIC_MODE: 'false',
    STEWARD_PUBLIC_MAX_ORDER_CENTS: '100000000',
    STEWARD_PUBLIC_MAX_DAILY_CENTS: '100000000',
    STEWARD_US_IP_BLOCK_ENABLED: 'true',
  });
  assert.equal(publicTradingVars({...release, enabled: true}).PUBLIC_MODE, 'true');
});

test('public release config rejects missing or unsafe values', () => {
  for (const release of [null, {}, {enabled: 'true', maxOrderCents: 500, maxDailyCents: 2000},
    {enabled: false, maxOrderCents: 0, maxDailyCents: 2000, usIpBlockEnabled: true},
    {enabled: false, maxOrderCents: 500, maxDailyCents: 499, usIpBlockEnabled: true}]) {
    assert.throws(() => publicTradingVars(release));
  }
});
