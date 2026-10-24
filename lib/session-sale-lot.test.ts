import test from 'node:test';
import assert from 'node:assert/strict';
import {saleLot,isSellKind} from './session-sale-lot.ts';
const output={token:'0x'+'a'.repeat(40),fee:3000,tickSpacing:60};
// AAPL at $350, 18 decimals.
const base={output,decimals:18,amountCents:100,priceUpperMicroUsd:350_000_000n,priceLowerMicroUsd:349_000_000n};

test('a stop-loss lot is worth at most the rule amount and floors 10% under the stop',()=>{
 const lot=saleLot({...base,kind:'sell_below',thresholdCents:30000});
 // $1 / $350 = 0.002857... tokens
 assert.equal(lot.inputRaw,(10n**18n*1_000_000n/350_000_000n).toString());
 const value=BigInt(lot.inputRaw)*350_000_000n/10n**18n;assert.ok(value<=1_000_000n);
 // floor = qty * $300 * 0.90
 assert.equal(lot.minimumOutputRaw,(BigInt(lot.inputRaw)*270_000_000n/10n**18n).toString());
 assert.equal(lot.token,output.token);assert.equal(lot.fee,3000);
});
test('a take-profit lot floors 3% under the target; a scheduled lot 15% under the current price',()=>{
 const profit=saleLot({...base,kind:'sell_threshold',thresholdCents:40000});
 assert.equal(profit.minimumOutputRaw,(BigInt(profit.inputRaw)*388_000_000n/10n**18n).toString());
 const scheduled=saleLot({...base,kind:'sell_scheduled',thresholdCents:0});
 assert.equal(scheduled.minimumOutputRaw,(BigInt(scheduled.inputRaw)*(349_000_000n*8500n/10000n)/10n**18n).toString());
});
test('bad inputs fail closed',()=>{
 assert.throws(()=>saleLot({...base,kind:'sell_below',thresholdCents:0}));
 assert.throws(()=>saleLot({...base,kind:'sell_below',thresholdCents:30000,amountCents:100001}));
 assert.throws(()=>saleLot({...base,kind:'sell_below',thresholdCents:30000,priceLowerMicroUsd:400_000_000n}));
 assert.throws(()=>saleLot({...base,kind:'sell_below',thresholdCents:30000,decimals:0,amountCents:1}));
 assert.equal(isSellKind('sell_below'),true);assert.equal(isSellKind('threshold'),false);
});
