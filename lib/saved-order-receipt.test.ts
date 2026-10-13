import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedOrderReceipt } from './saved-order-receipt.ts';
const attempt = { state: 'confirmed', transaction_hash: `0x${'a'.repeat(64)}`, amount_cents: 1000 };
test('a trusted finalized receipt survives later provider unavailability', () => {
  const receipt = savedOrderReceipt(attempt);
  assert.equal(receipt?.outcome, 'verified_fill');
  assert.equal(receipt?.paidUsdg, '$10.00');
  assert.equal(receipt?.awaitingFinality, false);
  assert.equal(savedOrderReceipt({ ...attempt, state: 'reverted' })?.paidUsdg, null);
});
test('unresolved, malformed or hashless records never claim a verified receipt', () => {
  for (const state of ['reserved','attempting','submitted','unknown','released'])
    assert.equal(savedOrderReceipt({ ...attempt, state }), null);
  assert.equal(savedOrderReceipt({ ...attempt, transaction_hash: null }), null);
  assert.equal(savedOrderReceipt({ ...attempt, amount_cents: NaN }), null);
});
