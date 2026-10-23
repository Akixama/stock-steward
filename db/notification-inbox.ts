import type { PriceAlert } from '../lib/price-alerts.ts';
import type { AutomaticStageEvent } from './automatic-stage-events.ts';

export type InboxItem = { id: string; kind: 'test' | 'price' | 'proposal'; title: string; body: string; symbol: string | null; created_at: string; read_at: string | null };

export async function saveInboxItem(db: D1Database, owner: string, item: Omit<InboxItem, 'read_at'>): Promise<boolean> {
  const result = await db.prepare('INSERT OR IGNORE INTO notification_inbox(id,owner_ref,kind,title,body,symbol,created_at,read_at) VALUES(?,?,?,?,?,?,?,NULL)')
    .bind(item.id, owner, item.kind, item.title, item.body, item.symbol, item.created_at).run();
  return result.meta.changes === 1;
}

export async function savePriceInbox(db: D1Database, owner: string, alerts: PriceAlert[]): Promise<void> {
  for (const alert of alerts) {
    if (alert.observedPriceCents === null) continue;
    await saveInboxItem(db, owner, { id: `price:${alert.id}`, kind: 'price', title: `${alert.symbol} price alert`,
      body: `${alert.symbol} ${alert.direction === 'above' ? 'reached' : 'fell to'} $${(alert.observedPriceCents / 100).toFixed(2)}. Your target was $${(alert.priceCents / 100).toFixed(2)}.`,
      symbol: alert.symbol, created_at: alert.triggeredAt ?? new Date().toISOString() });
  }
}

export async function saveProposalInbox(db: D1Database, event: AutomaticStageEvent): Promise<void> {
  if (event.kind !== 'proposal') return;
  await saveInboxItem(db, event.owner_ref, { id: `proposal:${event.id}`, kind: 'proposal', title: `${event.symbol} buy idea to review`,
    body: `Your rule suggests about $${(event.amount_cents / 100).toFixed(2)}. Open Buy for a fresh quote; only your wallet signature can place it.`,
    symbol: event.symbol, created_at: event.created_at });
}

// Repair a missed inbox write from a completed price check or saved proposal.
// The source records are immutable for these events; INSERT OR IGNORE keeps the
// original unread/read state even when a visitor reloads the page.
export async function backfillInbox(db: D1Database, owner: string): Promise<void> {
  const prices = (await db.prepare("SELECT id,symbol,direction,price_cents,observed_price_cents,triggered_at FROM price_alerts WHERE owner_ref=? AND status='triggered' ORDER BY triggered_at DESC LIMIT 100")
    .bind(owner).all<{ id: string; symbol: string; direction: 'above' | 'below'; price_cents: number; observed_price_cents: number; triggered_at: string }>()).results;
  for (const alert of prices) if (alert.observed_price_cents !== null) await saveInboxItem(db, owner, { id: `price:${alert.id}`, kind: 'price', title: `${alert.symbol} price alert`,
    body: `${alert.symbol} ${alert.direction === 'above' ? 'reached' : 'fell to'} $${(alert.observed_price_cents / 100).toFixed(2)}. Your target was $${(alert.price_cents / 100).toFixed(2)}.`,
    symbol: alert.symbol, created_at: alert.triggered_at });
  const proposals = (await db.prepare("SELECT id,owner_ref,run_id,kind,status,symbol,amount_cents,detail,transaction_hash,created_at,expires_at FROM automatic_stage_events WHERE owner_ref=? AND kind='proposal' ORDER BY created_at DESC LIMIT 100")
    .bind(owner).all<AutomaticStageEvent>()).results;
  for (const event of proposals) await saveProposalInbox(db, event);
}

export async function inbox(db: D1Database, owner: string) {
  const [items, count] = await Promise.all([
    db.prepare('SELECT id,kind,title,body,symbol,created_at,read_at FROM notification_inbox WHERE owner_ref=? ORDER BY created_at DESC LIMIT 100').bind(owner).all<InboxItem>(),
    db.prepare('SELECT COUNT(*) AS n FROM notification_inbox WHERE owner_ref=? AND read_at IS NULL').bind(owner).first<{ n: number }>(),
  ]);
  return { items: items.results ?? [], unread: count?.n ?? 0 };
}

export async function markInboxRead(db: D1Database, owner: string, id: string): Promise<boolean> {
  const result = await db.prepare('UPDATE notification_inbox SET read_at=? WHERE owner_ref=? AND id=? AND read_at IS NULL')
    .bind(new Date().toISOString(), owner, id).run();
  return result.meta.changes === 1;
}

export async function createTestInbox(db: D1Database, owner: string, now = new Date()): Promise<InboxItem> {
  const day = now.toISOString().slice(0, 10);
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM notification_inbox WHERE owner_ref=? AND kind='test' AND created_at>=? AND created_at<?")
    .bind(owner, `${day}T00:00:00.000Z`, new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000).toISOString()).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 5) throw Error('You can send up to five test alerts per UTC day.');
  const item: InboxItem = { id: `test:${crypto.randomUUID()}`, kind: 'test', title: 'Test alert',
    body: 'Your in-app alerts are working. This is a test; no order was placed.', symbol: null, created_at: now.toISOString(), read_at: null };
  await saveInboxItem(db, owner, item);
  return item;
}
