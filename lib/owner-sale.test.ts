import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { ownerSaleTransaction } from './owner-sale.ts';
import { ownerSafeAbi } from './previous-wallet-transfer.ts';
import { MULTISEND } from './safe-setup.ts';
import { VENUE, poolIdentity, type RouteEvidence } from './chain-route.ts';
import { PERMIT2 } from './install-flow.ts';
import { EXECUTION_CONTRACTS } from './autonomy.ts';

const safe = '0x123b44550990c3d61c9a7954ccaf820040a145eb' as Address;
const owner = '0xdc7f175bca1c29a77286a52c857e7fef12f3f662' as Address;
const token = '0x1111111111111111111111111111111111111111' as Address;
const pool = poolIdentity(token, 3000, 60);
function fixture(): RouteEvidence { return { side: 'sell', id: 'test', chainId: 4663, address: safe, symbol: 'AAPL', token, settlement: VENUE.settlement, input: '0.02', inputRaw: '20000000000000000', settlementDecimals: 6, block: '0x1', blockHash: '0x'+'2'.repeat(64), blockAt: new Date().toISOString(), observedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+30000).toISOString(), balanceRaw: '20000000000000000', slippageBps: 50, probes: [], best: { fee: 3000, tickSpacing: 60, poolId: pool.poolId, state: 'quoted', outputRaw: '7000000', reason: 'test' }, minimumOutputRaw: '6965000', executionEnabled: false, coverage: '', blockers: [] }; }
test('sale is one owner-signed Safe batch with no ETH value and a fixed USDG floor', () => {
  const tx = ownerSaleTransaction(fixture(), owner);
  const outer = decodeFunctionData({abi: ownerSafeAbi, data: tx.data});
  assert.equal(tx.from, owner);
  assert.equal(tx.to, safe);
  assert.equal(tx.value, '0x0');
  assert.ok(outer.args);
  assert.equal(String(outer.args[0]).toLowerCase(), MULTISEND.address.toLowerCase());
  assert.equal(outer.args[3], 1);
  assert.equal(String(outer.args[9]).slice(-2), '01');
  assert.equal(tx.minimumUsdgRaw, '6965000');
  const batch = decodeFunctionData({abi:parseAbi(['function multiSend(bytes transactions)']),data:outer.args[2] as Hex});
  assert.ok(batch.args);
  let bytes=String(batch.args[0]).slice(2);
  const calls:{operation:number;to:string;value:bigint;data:Hex}[]=[];
  while(bytes){
    const operation=Number.parseInt(bytes.slice(0,2),16);
    const to=`0x${bytes.slice(2,42)}`;
    const value=BigInt(`0x${bytes.slice(42,106)}`);
    const length=Number(BigInt(`0x${bytes.slice(106,170)}`));
    const data=`0x${bytes.slice(170,170+length*2)}` as Hex;
    calls.push({operation,to,value,data});
    bytes=bytes.slice(170+length*2);
  }
  assert.deepEqual(calls.map(call=>call.to.toLowerCase()),[token,PERMIT2,EXECUTION_CONTRACTS.router].map(value=>value.toLowerCase()));
  assert.deepEqual(calls.map(call=>call.operation),[0,0,0]);
  assert.deepEqual(calls.map(call=>call.value),[0n,0n,0n]);
  const approval=decodeFunctionData({abi:parseAbi(['function approve(address spender,uint256 amount) returns (bool)']),data:calls[0].data});
  assert.equal(String(approval.args?.[0]).toLowerCase(),PERMIT2.toLowerCase());
  assert.equal(approval.args?.[1],20000000000000000n);
  const permit=decodeFunctionData({abi:parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']),data:calls[1].data});
  assert.equal(String(permit.args?.[0]).toLowerCase(),token.toLowerCase());
  assert.equal(String(permit.args?.[1]).toLowerCase(),EXECUTION_CONTRACTS.router.toLowerCase());
  assert.equal(permit.args?.[2],20000000000000000n);
});
test('sale refuses buy side, zero or excessive input, and expired quote', () => {
  const route = fixture();
  assert.throws(() => ownerSaleTransaction({...route, side:'buy'}, owner));
  assert.throws(() => ownerSaleTransaction({...route, inputRaw:'0'}, owner));
  assert.throws(() => ownerSaleTransaction({...route, inputRaw:(2n**160n).toString()}, owner));
  assert.throws(() => ownerSaleTransaction({...route, expiresAt:new Date(Date.now()-1000).toISOString()}, owner));
});
