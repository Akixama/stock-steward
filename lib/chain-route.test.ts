import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, keccak256, toHex } from 'viem';
import { inspectRoute, poolIdentity, VENUE } from './chain-route.ts';

const TOKEN = '0x1111111111111111111111111111111111111111';
const USER = '0x2222222222222222222222222222222222222222';
const BLOCK = '0x100';
const HASH = '0x' + 'ab'.repeat(32);
const sel = (sig: string) => keccak256(toHex(sig)).slice(0, 10);
const u256 = (v: bigint) => encodeAbiParameters([{ type: 'uint256' }], [v]);
const quotedPool = poolIdentity(TOKEN as `0x${string}`, 3000, 60).poolId;

function registryBody() {
  return { assets: [{ tokenSymbol: 'AAPL', status: 'ASSET_STATUS_ACTIVE', currentMultiplier: '1',
    deployments: [{ chainId: 4663, contractAddress: TOKEN }] }] };
}

function headerBody() {
  return { hash: HASH, number: BLOCK, timestamp: toHex(BigInt(Math.floor(Date.now() / 1000))) };
}

function callResult(to: string, data: string): unknown {
  const selector = data.slice(0, 10);
  if (selector === sel('poolManager()')) return encodeAbiParameters([{ type: 'address' }], [VENUE.manager as `0x${string}`]);
  if (selector === sel('decimals()')) return encodeAbiParameters([{ type: 'uint8' }], [to.toLowerCase() === VENUE.settlement ? 6 : 18]);
  if (selector === sel('balanceOf(address)')) return u256(2000000n);
  if (selector === sel('getSlot0(bytes32)')) {
    const poolId = ('0x' + data.slice(-64)).toLowerCase();
    const live = poolId === quotedPool.toLowerCase();
    return encodeAbiParameters(
      [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }],
      live ? [123456789n, 0, 0, 0] : [0n, 0, 0, 0]);
  }
  if (selector === sel('getLiquidity(bytes32)')) return encodeAbiParameters([{ type: 'uint128' }], [10n ** 18n]);
  if (selector === sel('quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))')) {
    return encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [500000000000000000n, 100000n]);
  }
  throw new Error('unexpected call ' + selector);
}

function singleResult(method: string, params: unknown[]): unknown {
  if (method === 'eth_chainId') return '0x1237';
  if (method === 'eth_blockNumber') return BLOCK;
  if (method === 'eth_getBlockByNumber') return headerBody();
  if (method === 'eth_getCode') return '0x1234';
  if (method === 'eth_call') {
    const p = params[0] as { to: string; data: string };
    return callResult(p.to, p.data);
  }
  throw new Error('unexpected method ' + method);
}

const calls = { count: 0 };

async function stubFetch(input: unknown, init?: unknown): Promise<unknown> {
  calls.count++;
  const url = String(input);
  if (url.includes('rhj/assets')) return { ok: true, json: async () => registryBody() };
  const body = JSON.parse((init as { body: string }).body) as
    { id: number; method: string; params: unknown[] } | { id: number; method: string; params: unknown[] }[];
  if (Array.isArray(body)) {
    return { ok: true, json: async () => body.map((entry) => ({
      jsonrpc: '2.0', id: entry.id, result: singleResult(entry.method, entry.params) })) };
  }
  return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result: singleResult(body.method, body.params) }) };
}

test('batched inspection quotes one pool and stays within a few requests', async () => {
  calls.count = 0;
  const evidence = await inspectRoute(USER, 'AAPL', '1.00', 50, stubFetch as unknown as typeof fetch);
  assert.equal(evidence.inputRaw, '1000000');
  assert.equal(evidence.balanceRaw, '2000000');
  assert.equal(evidence.best?.fee, 3000);
  assert.equal(evidence.minimumOutputRaw, ((500000000000000000n * 9950n) / 10000n).toString());
  assert.equal(evidence.probes.filter((p) => p.state === 'quoted').length, 1);
  assert.equal(evidence.probes.filter((p) => p.state === 'uninitialized').length, 3);
  assert.ok(calls.count <= 10, `expected few requests, saw ${calls.count}`);
});
