import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { assertTradeAgreement, ipLocationBlock, saveTradeAgreement, tradeAgreement } from './trade-agreement.ts';
import { TERMS_VERSION } from '../config/public-launch-copy.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../drizzle/0038_trade_agreements.sql', import.meta.url), 'utf8'));
  const db = { prepare(query: string) { let args: unknown[] = []; const stmt = {
    bind(...values: unknown[]) { args = values; return stmt; },
    async first() { return sql.prepare(query).get(...args as never[]) ?? null; },
    async run() { return sql.prepare(query).run(...args as never[]); },
  }; return stmt; } } as unknown as D1Database;
  return { sql, db };
}

test('agreement is required, saved per user with current version and timestamp', async () => {
  const { sql, db } = fixture();
  const request = new Request('https://example.com/api/workspace/orders/live/prepare');
  try {
    await assert.rejects(assertTradeAgreement(db, 'alice', request, { STEWARD_US_IP_BLOCK_ENABLED: 'true' }), /Accept the current terms/);
    await saveTradeAgreement(db, 'alice', new Date('2026-10-22T10:00:00Z'));
    assert.deepEqual(await tradeAgreement(db, 'alice'), { accepted: true, acceptedAt: '2026-10-22T10:00:00.000Z', termsVersion: TERMS_VERSION });
    assert.equal((await tradeAgreement(db, 'bob')).accepted, false);
    await assert.doesNotReject(assertTradeAgreement(db, 'alice', request, { STEWARD_US_IP_BLOCK_ENABLED: 'true' }));
    sql.prepare("UPDATE trade_agreements SET terms_version='old' WHERE owner_ref='alice'").run();
    await assert.rejects(assertTradeAgreement(db, 'alice', request, {}), /Accept the current terms/);
  } finally { sql.close(); }
});

test('US IP signal blocks an accepted user only when enabled and never proves eligibility elsewhere', async () => {
  const { sql, db } = fixture();
  const us = new Request('https://example.com', { headers: { 'cf-ipcountry': 'US' } });
  const elsewhere = new Request('https://example.com', { headers: { 'cf-ipcountry': 'NG' } });
  try {
    await saveTradeAgreement(db, 'alice');
    assert.match(ipLocationBlock(us, { STEWARD_US_IP_BLOCK_ENABLED: 'true' }) ?? '', /United States|US/i);
    await assert.rejects(assertTradeAgreement(db, 'alice', us, { STEWARD_US_IP_BLOCK_ENABLED: 'true' }), /United States|US/i);
    assert.equal(ipLocationBlock(us, { STEWARD_US_IP_BLOCK_ENABLED: 'false' }), null);
    assert.equal(ipLocationBlock(elsewhere, { STEWARD_US_IP_BLOCK_ENABLED: 'true' }), null);
  } finally { sql.close(); }
});
