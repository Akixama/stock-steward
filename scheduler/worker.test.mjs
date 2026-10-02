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
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(worker.scheduled({}, env), /HTTP 503/);
    globalThis.fetch = async () => Response.json({ summary: {}, spendingEnabled: true });
    await assert.rejects(worker.scheduled({}, env), /Unexpected/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
