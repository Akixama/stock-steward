import test from 'node:test';
import assert from 'node:assert/strict';
import {portfolioValue,walletBalanceFingerprint} from './portfolio-value.ts';

test('verified cash is the total when no stock is held',()=>{
  assert.equal(portfolioValue(10_000_000n,0,null),10_000_000n);
  assert.equal(portfolioValue(10_000_000n,1,null),null);
  assert.equal(portfolioValue(10_000_000n,1,2_000_000n),12_000_000n);
  assert.equal(portfolioValue(null,0,null),null);
});

test('balance fingerprint changes for deposits and token changes but refuses partial reads',()=>{
  const wallet={safe:'0x123',usdg:'1',holdings:[{symbol:'AAPL',tokens:'0'}]};
  assert.notEqual(walletBalanceFingerprint(wallet),walletBalanceFingerprint({...wallet,usdg:'2'}));
  assert.equal(walletBalanceFingerprint({...wallet,usdg:null}),null);
  assert.equal(walletBalanceFingerprint({...wallet,holdings:[{symbol:'AAPL',tokens:null}]}),null);
});
