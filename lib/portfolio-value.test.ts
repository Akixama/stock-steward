import test from 'node:test';
import assert from 'node:assert/strict';
import {portfolioValue,visiblePortfolioValue,walletBalanceFingerprint} from './portfolio-value.ts';

test('verified cash is the total when no stock is held',()=>{
  assert.equal(portfolioValue(10_000_000n,0,null),10_000_000n);
  assert.equal(portfolioValue(10_000_000n,1,null),null);
  assert.equal(portfolioValue(10_000_000n,1,2_000_000n),12_000_000n);
  assert.equal(portfolioValue(null,0,null),null);
});

test('a partial display keeps known cash and only priced stock values',()=>{
  assert.equal(visiblePortfolioValue(300000n,null),300000n);
  assert.equal(visiblePortfolioValue(300000n,9500000n),9800000n);
  assert.equal(visiblePortfolioValue(null,9500000n),null);
});

test('balance fingerprint changes for deposits and token changes but refuses partial reads',()=>{
  const wallet={safe:'0x123',usdg:'1',holdings:[{symbol:'AAPL',tokens:'0'}]};
  assert.notEqual(walletBalanceFingerprint(wallet),walletBalanceFingerprint({...wallet,usdg:'2'}));
  assert.equal(walletBalanceFingerprint({...wallet,usdg:null}),null);
  assert.equal(walletBalanceFingerprint({...wallet,holdings:[{symbol:'AAPL',tokens:null}]}),null);
});
