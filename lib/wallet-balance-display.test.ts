import test from 'node:test';
import assert from 'node:assert/strict';
import { completeWalletBalance, currentPortfolioValue, parseLastVerifiedBalance, stockHoldingCount } from './wallet-balance-display.ts';

const complete = { safe: '0x'+'1'.repeat(40), usdg: '0.3', holdings: [{ symbol: 'MSFT', tokens: '0.018' }],
  verified: true, balanceReadComplete: true, checkedAt: '2026-10-21T12:00:00.000Z' };

test('a failed cash, stock, or registry read never displays zero holdings', () => {
  assert.equal(stockHoldingCount(complete), 1);
  assert.equal(stockHoldingCount({ ...complete, holdings: [{ symbol: 'MSFT', tokens: '0' }] }), 0);
  assert.equal(stockHoldingCount({ ...complete, usdg: null }), null);
  assert.equal(stockHoldingCount({ ...complete, holdings: [{ symbol: 'MSFT', tokens: null }] }), null);
  assert.equal(stockHoldingCount({ ...complete, holdings: [], balanceReadComplete: false }), null);
  assert.equal(stockHoldingCount({ ...complete, checkedAt: null }), null);
});

test('a partial balance read never presents cash alone as the current portfolio value', () => {
  assert.equal(currentPortfolioValue(0n, null, false), null);
  assert.equal(currentPortfolioValue(300000n, null, false), null);
  assert.equal(currentPortfolioValue(300000n, null, true), 300000n);
  assert.equal(currentPortfolioValue(300000n, 1000000n, true), 1300000n);
});

test('only a complete, dated balance for the same wallet is retained', () => {
  assert.equal(completeWalletBalance(complete), true);
  assert.deepEqual(parseLastVerifiedBalance(JSON.stringify(complete), complete.safe), complete);
  assert.deepEqual(parseLastVerifiedBalance(JSON.stringify(complete)), complete);
  assert.equal(parseLastVerifiedBalance(JSON.stringify(complete), '0x456'), null);
  assert.equal(parseLastVerifiedBalance(JSON.stringify({ ...complete, balanceReadComplete: false }), complete.safe), null);
  assert.equal(parseLastVerifiedBalance('{', complete.safe), null);
});
