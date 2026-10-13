import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePendingWalletReceipt, pendingReceiptKey } from './pending-wallet-receipt.ts';
test('receipt recovery accepts only bounded transaction and intent pointers', () => {
  const receipt={hash:'0x'+'a'.repeat(64),intentDigest:'0x'+'b'.repeat(64)};
  assert.deepEqual(parsePendingWalletReceipt(JSON.stringify(receipt)),receipt);
  for(const raw of [null,'{','null','{}',JSON.stringify({...receipt,hash:'0x1'}),'x'.repeat(501)])assert.equal(parsePendingWalletReceipt(raw),null);
  assert.equal(pendingReceiptKey('0xABC'),pendingReceiptKey('0xabc'));
});
