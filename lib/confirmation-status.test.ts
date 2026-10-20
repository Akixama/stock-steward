import test from 'node:test';
import assert from 'node:assert/strict';
import {earlyConfirmationCount,hasEarlyConfirmations} from './confirmation-status.ts';

test('early confirmation block count is bounded and configurable',()=>{
  assert.equal(earlyConfirmationCount('4'),4);
  assert.equal(earlyConfirmationCount('0'),12);
  assert.equal(earlyConfirmationCount('500'),12);
  assert.equal(hasEarlyConfirmations('0x13','0x10',4),true);
  assert.equal(hasEarlyConfirmations('0x12','0x10',4),false);
  assert.equal(hasEarlyConfirmations(null,'0x10',4),false);
});
