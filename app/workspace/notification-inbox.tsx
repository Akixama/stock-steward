'use client';
import { useCallback, useEffect, useState } from 'react';
import type { InboxItem } from '@/db/notification-inbox';
import { formatWorkspaceDate } from '@/lib/workspace-date';

export default function NotificationInbox({ onCount, onReviewBuy }: { onCount: (count: number) => void; onReviewBuy: () => void }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    const response = await fetch('/api/workspace/notifications', { cache: 'no-store' });
    const data = await response.json() as { items?: InboxItem[]; unread?: number; error?: string };
    if (!response.ok || !data.items || typeof data.unread !== 'number') throw Error(data.error ?? 'Inbox unavailable.');
    setItems(data.items); onCount(data.unread);
  }, [onCount]);
  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : 'Inbox unavailable.')); }, [load]);
  useEffect(() => {
    const update = () => { void load().catch(() => setError('Inbox unavailable.')); };
    window.addEventListener('stock-steward:alerts-updated', update);
    return () => window.removeEventListener('stock-steward:alerts-updated', update);
  }, [load]);
  async function post(body: object) {
    const response = await fetch('/api/workspace/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json() as { error?: string; push?: string };
    if (!response.ok) throw Error(data.error ?? 'Alert action unavailable.');
    return data;
  }
  async function testAlert() {
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { const result = await post({ action: 'test' }); await load(); setNotice(result.push === 'sent' ? 'Test alert saved here and sent to your subscribed device.' : 'Test alert saved here. Device push needs notification permission on that device.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Test alert unavailable.'); }
    finally { setBusy(false); }
  }
  async function open(item: InboxItem) {
    if (!item.read_at) {
      try { await post({ action: 'read', id: item.id }); await load(); }
      catch { setError('Could not mark this alert as read.'); }
    }
    if (item.kind === 'proposal') onReviewBuy();
  }
  return <section className="ws-inbox" aria-label="Notification inbox">
    <div className="ws-alert-list-head"><div><span className="ws-label">INBOX</span><h2>Updates for you</h2><small>Saved here without browser permissions. Device notifications are optional.</small></div><button type="button" className="ws-action-secondary" disabled={busy} onClick={() => void testAlert()}>{busy ? 'Sending…' : 'Send me a test alert'}</button></div>
    {notice && <p className="ws-alert-notice" role="status">{notice}</p>}{error && <p className="ws-error" role="alert">{error}</p>}
    {!items.length && <p className="ws-alert-empty">No updates yet. Test the inbox or set a price alert.</p>}
    {items.map(item => <div className="ws-inbox-item" data-unread={!item.read_at} key={item.id}><div><strong>{item.title}</strong><p>{item.body}</p><small>{formatWorkspaceDate(item.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small></div><button type="button" className="ws-action-quiet" onClick={() => void open(item)}>{item.kind === 'proposal' ? 'Open Buy for a fresh quote' : item.read_at ? 'Read' : 'Mark read'}</button></div>)}
  </section>;
}
