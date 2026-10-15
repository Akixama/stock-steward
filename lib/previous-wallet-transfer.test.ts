import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeFunctionData,type Address} from 'viem';
import {ownerSafeAbi,ownerTransferTransaction,transferAbi} from './previous-wallet-transfer.ts';

const safe='0x123b44550990C3d61c9A7954CcAf820040A145eb' as Address;
const owner='0xdc7f175bca1c29a77286a52c857e7fef12f3f662' as Address;
const token='0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as Address;
test('previous wallet transfer sends only a token balance to its owner',()=>{
 const plan=ownerTransferTransaction({safe,owner,token,amount:1000000n});
 assert.equal(plan.from,owner);assert.equal(plan.to,safe);assert.equal(plan.value,'0x0');
 const outer=decodeFunctionData({abi:ownerSafeAbi,data:plan.data});
 assert.equal(outer.functionName,'execTransaction');assert.equal(outer.args[0],token);assert.equal(outer.args[1],0n);assert.equal(outer.args[3],0);
 assert.equal(outer.args[4],0n);assert.equal(outer.args[6],0n);assert.equal(outer.args[9].slice(-2),'01');
 const inner=decodeFunctionData({abi:transferAbi,data:outer.args[2]});assert.equal(inner.functionName,'transfer');assert.equal(inner.args[0].toLowerCase(),owner.toLowerCase());assert.equal(inner.args[1],1000000n);
});
test('zero balance and malformed addresses cannot produce a transfer',()=>{
 assert.throws(()=>ownerTransferTransaction({safe,owner,token,amount:0n}));
 assert.throws(()=>ownerTransferTransaction({safe,owner,token:'0x0000000000000000000000000000000000000000',amount:1n}));
});
