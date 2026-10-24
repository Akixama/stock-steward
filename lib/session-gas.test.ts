import test from 'node:test';
import assert from 'node:assert/strict';
import {gasStatus} from './session-gas.ts';
const eth=3_000_000_000n; // $3,000
test('turns session ETH into trades left at the fee limit',()=>{
 const g=gasStatus(10n**15n,eth,50); // 0.001 ETH = $3.00, $0.50 per trade
 assert.equal(g.balanceCents,300);assert.equal(g.tradesLeft,6);assert.equal(g.state,'ok');
 // top-up covers 10 trades: $5 = 0.0016667 ETH, rounded up
 assert.equal(g.topUpWei,((5_000_000n*10n**18n+eth-1n)/eth).toString());
});
test('warns when low, stops when empty, and admits when it cannot tell',()=>{
 assert.equal(gasStatus(5n*10n**14n,eth,100).state,'low');   // $1.50 at $1 = 1 trade
 assert.equal(gasStatus(10n**13n,eth,100).state,'empty');     // $0.03
 assert.equal(gasStatus(0n,null,50).state,'empty');
 assert.equal(gasStatus(10n**15n,null,50).state,'unknown');
});
