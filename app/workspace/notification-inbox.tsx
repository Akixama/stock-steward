'use client';
import { useCallback, useEffect, useState } from 'react';
import type { InboxItem } from '@/db/notification-inbox';
import { formatWorkspaceDate } from '@/lib/workspace-date';
import {buyIdeaFromClaim,type BuyIdea} from '@/lib/buy-idea';

export default function NotificationInbox({ onCount, onReviewBuy }: { onCount: (count: number) => void; onReviewBuy: (idea: BuyIdea) => void }) {
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
    const data = await response.json() as { error?: string; push?: string; proposal?:unknown };
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
    if(item.kind==='proposal'){
      if(busy)return;setBusy(true);setError('');
      try{const result=await post({action:'review_proposal',id:item.id});const idea=buyIdeaFromClaim(result.proposal);await load();onReviewBuy(idea);}
      catch(cause){setError(cause instanceof Error?cause.message:'This idea could not open. No order was sent.');}
      finally{setBusy(false);}
      return;
    }
    if (!item.read_at) {
      try { await post({ action: 'read', id: item.id }); await load(); }
      catch { setError('Could not mark this alert as read.'); }
    }
  }
  const current=Date.now();
  const ideas=items.filter(item=>item.kind==='proposal'&&item.proposal_status==='proposed'&&!!item.proposal_expires_at&&Date.parse(item.proposal_expires_at)>current);
  const pastIdeas=items.filter(item=>item.kind==='proposal'&&!ideas.includes(item));
  const updates=items.filter(item=>item.kind!=='proposal');
  return <section className="ws-inbox" aria-label="Notification inbox">
    <div className="ws-alert-list-head"><div><span className="ws-label">INBOX</span><h2>Updates for you</h2><small>Saved here without browser permissions. Device notifications are optional.</small></div><button type="button" className="ws-action-secondary" disabled={busy} onClick={() => void testAlert()}>{busy ? 'Sending…' : 'Send me a test alert'}</button></div>
    {notice && <p className="ws-alert-notice" role="status">{notice}</p>}{error && <p className="ws-error" role="alert">{error}</p>}
    {!items.length && <p className="ws-alert-empty">No updates yet. Test the inbox or set a price alert.</p>}
    {!!ideas.length&&<div className="ws-ideas"><div className="ws-ideas-heading"><span className="ws-label">BUY IDEAS</span><p>Ideas spend nothing. Buy opens a fresh quote using your saved per-buy amount; you still sign in your wallet.</p></div>{ideas.map(item=><article className="ws-idea" key={item.id}><div><strong>{item.symbol??'Stock'} <span>· {item.proposal_amount_cents==null?'Amount unavailable':`$${(item.proposal_amount_cents/100).toFixed(2)}`} idea</span></strong><small>{formatWorkspaceDate(item.created_at,{dateStyle:'medium',timeStyle:'short'})} · Expires {formatWorkspaceDate(item.proposal_expires_at!,{hour:'numeric',minute:'2-digit'})}</small></div><button type="button" className="ws-action-primary" disabled={busy} onClick={()=>void open(item)}>Review idea</button></article>)}</div>}
    {updates.map(item=><div className="ws-inbox-item" data-unread={!item.read_at} key={item.id}><div><strong>{item.title}</strong><p>{item.body}</p><small>{formatWorkspaceDate(item.created_at,{dateStyle:'medium',timeStyle:'short'})}</small></div><button type="button" disabled={busy} className="ws-action-quiet" onClick={()=>void open(item)}>{item.read_at?'Read':'Mark read'}</button></div>)}
    {!!pastIdeas.length&&<details className="ws-past-ideas"><summary>Past ideas <span>{pastIdeas.length}</span></summary>{pastIdeas.map(item=><div className="ws-past-idea" key={item.id}><strong>{item.symbol??'Stock'} · {item.proposal_amount_cents==null?'Amount unavailable':`$${(item.proposal_amount_cents/100).toFixed(2)}`}</strong><small>{item.proposal_status==='proposed'?'Expired':'Already opened'} · {formatWorkspaceDate(item.created_at,{dateStyle:'medium',timeStyle:'short'})}</small></div>)}</details>}
  </section>;
}
