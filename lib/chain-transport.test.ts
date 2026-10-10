import test from 'node:test';
import assert from 'node:assert/strict';
import { chainTransport } from './chain-transport.ts';
import { CHAIN } from './robinhood-chain.ts';

const okResponse = () => ({ ok: true, status: 200 }) as unknown as Response;
const badResponse = () => ({ ok: false, status: 400 }) as unknown as Response;

async function flakyOnce(calls: { count: number }): Promise<Response> {
  calls.count++;
  if (calls.count === 1) throw new Error('socket hang up');
  return okResponse();
}

async function alwaysDown(calls: { count: number }): Promise<Response> {
  calls.count++;
  throw new Error('connection reset');
}

test('a single network failure is retried once, then succeeds', async () => {
  const calls = { count: 0 };
  const upstream = ((..._args: unknown[]) => flakyOnce(calls)) as unknown as typeof fetch;
  const transport = chainTransport('key123', upstream);
  const response = await transport(CHAIN.rpc, { method: 'POST' });
  assert.equal(response.ok, true);
  assert.equal(calls.count, 2);
});

test('persistent failure throws after two attempts', async () => {
  const calls = { count: 0 };
  const upstream = ((..._args: unknown[]) => alwaysDown(calls)) as unknown as typeof fetch;
  const transport = chainTransport('key123', upstream);
  await assert.rejects(transport(CHAIN.rpc, { method: 'POST' }), /RPC transport unavailable/);
  assert.equal(calls.count, 2);
});

test('a caller timeout keeps a single attempt', async () => {
  const calls = { count: 0 };
  const upstream = ((..._args: unknown[]) => alwaysDown(calls)) as unknown as typeof fetch;
  const transport = chainTransport(undefined, upstream);
  await assert.rejects(
    transport('https://api.robinhood.com/rhj/assets', { signal: AbortSignal.timeout(1000) }),
    /Registry transport unavailable/);
  assert.equal(calls.count, 1);
});

test('an HTTP error passes through without throwing', async () => {
  const upstream = (async () => badResponse()) as unknown as typeof fetch;
  const transport = chainTransport('key123', upstream);
  const response = await transport(CHAIN.rpc, { method: 'POST' });
  assert.equal(response.ok, false);
});
