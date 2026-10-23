import test from 'node:test';
import assert from 'node:assert/strict';
import {buyIdeaAmount,buyIdeaFromClaim} from './buy-idea.ts';

test('claim carries stock and exact suggestion into Buy',()=>{
  assert.deepEqual(buyIdeaFromClaim({symbol:'AAPL',amount_cents:10,expires_at:'2026-10-23T12:00:00Z'}),{symbol:'AAPL',amountCents:10});
  assert.throws(()=>buyIdeaFromClaim({symbol:'AAPL'}),/could not open/);
});
test('Buy review names its saved amount whenever it differs from the idea',()=>{
  const mismatch=buyIdeaAmount(10,10000);
  assert.equal(mismatch.differs,true);
  assert.match(mismatch.label,/idea suggested \$0\.10/);
  assert.match(mismatch.label,/review will use \$100\.00, not the idea amount/);
  assert.equal(buyIdeaAmount(100,100).differs,false);
});
