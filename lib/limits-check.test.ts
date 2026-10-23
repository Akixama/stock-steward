import test from 'node:test';
import assert from 'node:assert/strict';
import {limitsCheck,parseDollars} from './limits-check.ts';

const limits={allowedSymbols:['AAPL','MSFT'],maxOrderCents:1000,maxDailyBuyCents:5000,version:3};

test('a buy inside every limit fits',()=>{
  const result=limitsCheck(limits,'AAPL',1000,2000);
  assert.equal(result.fits,true);
  assert.deepEqual(result.lines.map(line=>line.ok),[true,true,true]);
  assert.match(result.lines[2].detail,/\$30\.00 left today/);
});
test('stock, per-buy and daily limits each block on their own',()=>{
  assert.equal(limitsCheck(limits,'TSLA',500).lines[0].ok,false);
  assert.equal(limitsCheck(limits,'AAPL',1001).lines[1].ok,false);
  assert.equal(limitsCheck(limits,'AAPL',1000,4500).lines[2].ok,false);
  assert.equal(limitsCheck(limits,'AAPL',1000,4500).fits,false);
});
test('no saved limits or a bad amount never fits',()=>{
  assert.equal(limitsCheck({...limits,version:0},'AAPL',100).fits,false);
  assert.equal(limitsCheck(limits,'AAPL',NaN).fits,false);
  assert.equal(parseDollars('10.5'),1050);assert.ok(Number.isNaN(parseDollars('1.234')));assert.ok(Number.isNaN(parseDollars('-1')));
});
