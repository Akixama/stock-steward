import test from 'node:test';
import assert from 'node:assert/strict';
import {marketActivityRows} from './market-activity.ts';

test('Markets labels unresolved receipts as unresolved and shows only saved hashes',()=>{
  const hash='0x'+'a'.repeat(64);
  const rows=marketActivityRows([{plan_json:JSON.stringify({route:{symbol:'AAPL',side:'buy'}}),amount_cents:100,state:'submitted',transaction_hash:hash,created_at:'2026-10-21T00:00:00Z'}],[]);
  assert.deepEqual(rows,[{side:'buy',symbol:'AAPL',amount:'$1.00',state:'submitted',hash,at:'2026-10-21T00:00:00Z'}]);
  assert.equal(marketActivityRows([{plan_json:'{}',transaction_hash:hash,created_at:'2026-10-21T00:00:00Z'}],[]).length,0);
});
