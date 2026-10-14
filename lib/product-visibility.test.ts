import test from 'node:test';
import assert from 'node:assert/strict';
import {AUTOMATIC_TRADING_ENABLED} from './product-flags.ts';

test('future automatic-trading product surfaces stay source-gated off',()=>{
  assert.equal(AUTOMATIC_TRADING_ENABLED,false);
});
