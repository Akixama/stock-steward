import assert from 'node:assert/strict';
import test from 'node:test';
import worker from './worker.mjs';

const key = 'a'.repeat(64);
const env = { STEWARD_WORKER_KEY: key, STEWARD_TICK_URL: 'https://example.test/api/internal/autonomy/tick' };

test('calls the protected tick once with the worker key', async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ summary: { practiceUpdated: 1 }, spendingEnabled: false });
  };
  console.log = () => {};
  try {
    await worker.scheduled({}, env);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, env.STEWARD_TICK_URL);
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${key}`);
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test('does not call the endpoint without a configured key', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected network call.'); };
  try {
    await assert.rejects(worker.scheduled({}, { ...env, STEWARD_WORKER_KEY: '' }), /missing or invalid/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects failed and unsafe endpoint responses', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'https://example.test/other' } });
    await assert.rejects(worker.scheduled({}, env), /HTTP 302/);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(worker.scheduled({}, env), /HTTP 503/);
    // v2: spending can legitimately be on; a malformed reply is still rejected.
    globalThis.fetch = async () => Response.json({ spendingEnabled: 'yes' });
    await assert.rejects(worker.scheduled({}, env), /Unexpected/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('runs the light rules pass between quarter hours and the full monitor on them', async () => {
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response(JSON.stringify({ spendingEnabled: false, summary: {} }), { status: 200 }); };
  const env = { STEWARD_WORKER_KEY: 'a'.repeat(64), STEWARD_TICK_URL: 'https://example.test/api/internal/monitor/tick' };
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 24, 12, 7) }, env);
  await worker.scheduled({ scheduledTime: Date.UTC(2026, 9, 24, 12, 15) }, env);
  assert.deepEqual(seen, ['https://example.test/api/internal/monitor/tick?fast=1', 'https://example.test/api/internal/monitor/tick']);
});
