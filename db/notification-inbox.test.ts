import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { automaticStageIntent, automaticStages } from '../lib/automatic-stages.ts';
import { backfillInbox, createTestInbox, inbox, markInboxRead, savePriceInbox, saveProposalInbox } from './notification-inbox.ts';
import type { AutomaticStageEvent } from './automatic-stage-events.ts';

function fixture() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE price_alerts(id TEXT, owner_ref TEXT, symbol TEXT, direction TEXT, price_cents INTEGER, observed_price_cents INTEGER, triggered_at TEXT, status TEXT)');
  sql.exec('CREATE TABLE automatic_stage_events(id TEXT,owner_ref TEXT,run_id TEXT,kind TEXT,status TEXT,symbol TEXT,amount_cents INTEGER,detail TEXT,transaction_hash TEXT,created_at TEXT,expires_at TEXT)');
  sql.exec(readFileSync(new URL('../drizzle/0039_notification_inbox.sql', import.meta.url), 'utf8'));
  const db = { prepare(query: string) { let args: unknown[] = []; const stmt = {
    bind(...values: unknown[]) { args = values; return stmt; },
    async run() { return { meta: { changes: Number(sql.prepare(query).run(...args as never[]).changes) } }; },
    async first() { return sql.prepare(query).get(...args as never[]) ?? null; },
    async all<T>() { return { results: sql.prepare(query).all(...args as never[]) as T[] }; },
  }; return stmt; } } as unknown as D1Database;
  return { sql, db };
}

test('in-app test alert needs no device and unread state is owner scoped', async () => {
  const { sql, db } = fixture();
  try {
    const now = new Date('2026-10-23T10:00:00Z');
    const item = await createTestInbox(db, 'alice', now);
    assert.equal((await inbox(db, 'alice')).unread, 1);
    assert.equal((await inbox(db, 'bob')).unread, 0);
    assert.equal(await markInboxRead(db, 'bob', item.id), false);
    assert.equal(await markInboxRead(db, 'alice', item.id), true);
    assert.equal((await inbox(db, 'alice')).unread, 0);
    for (let i = 0; i < 4; i++) await createTestInbox(db, 'alice', now);
    await assert.rejects(createTestInbox(db, 'alice', now), /five test alerts/);
    assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM notification_inbox').get()!.n), 5);
  } finally { sql.close(); }
});

test('price and proposal alerts are saved once; proposal is review-only with flags off', async () => {
  const { sql, db } = fixture();
  try {
    const price = { id: 'price-one', symbol: 'AAPL', direction: 'above' as const, priceCents: 35000,
      observedPriceCents: 35100, createdAt: '2026-10-23T10:00:00Z', triggeredAt: '2026-10-23T10:01:00Z', status: 'triggered' as const };
    await savePriceInbox(db, 'alice', [price, price]);
    const event: AutomaticStageEvent = { id: `${'0x' + 'a'.repeat(64)}:proposal`, owner_ref: 'alice', run_id: '0x' + 'a'.repeat(64),
      kind: 'proposal', status: 'proposed', symbol: 'AAPL', amount_cents: 100, detail: 'Review required.', transaction_hash: null,
      created_at: '2026-10-23T10:02:00Z', expires_at: '2026-10-23T10:17:00Z' };
    await saveProposalInbox(db, event); await saveProposalInbox(db, event);
    assert.equal((await inbox(db, 'alice')).unread, 2);
    assert.equal((await inbox(db, 'bob')).items.length, 0);
    assert.match((await inbox(db, 'alice')).items[0].body, /fresh quote.*wallet signature/);
    assert.equal(automaticStageIntent(automaticStages({ SHADOW_MODE: 'true', APPROVE_BY_NOTIFICATION: 'false', AUTO_BUY: 'false' }), true, true, 100), 'none');
    assert.equal(automaticStageIntent(automaticStages({ SHADOW_MODE: 'true', APPROVE_BY_NOTIFICATION: 'true', AUTO_BUY: 'false' }), true, true, 100), 'proposal');
    assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM notification_inbox').get()!.n), 2);
  } finally { sql.close(); }
});

test('reload repairs a missed alert write without marking a read alert unread', async () => {
  const { sql, db } = fixture();
  try {
    sql.prepare("INSERT INTO price_alerts VALUES('one','alice','MSFT','below',30000,29900,'2026-10-23T12:00:00Z','triggered')").run();
    await backfillInbox(db, 'alice');
    assert.equal((await inbox(db, 'alice')).unread, 1);
    await markInboxRead(db, 'alice', 'price:one');
    await backfillInbox(db, 'alice');
    assert.equal((await inbox(db, 'alice')).unread, 0);
  } finally { sql.close(); }
});
