'use client';
import { useEffect, useState } from 'react';
import { TERMS_VERSION, TRADE_AGREEMENT_LABEL, TRADING_RISK_TEXT, US_RESTRICTION_TEXT } from '@/config/public-launch-copy';

type Status = { accepted: boolean; termsVersion: string; acceptedAt: string | null; locationBlock: string | null };
export default function TradeAgreement({ onReady }: { onReady: (ready: boolean) => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    const response = await fetch('/api/workspace/trade-agreement', { cache: 'no-store' });
    const body = await response.json() as Status & { error?: string };
    if (!response.ok) throw Error(body.error ?? 'Agreement status unavailable.');
    setStatus(body); onReady(body.accepted && !body.locationBlock);
  }
  useEffect(() => { let active = true; void fetch('/api/workspace/trade-agreement', { cache: 'no-store' })
    .then(async response => { const body = await response.json() as Status & { error?: string }; if (!response.ok) throw Error(body.error ?? 'Agreement status unavailable.'); return body; })
    .then(body => { if (active) { setStatus(body); onReady(body.accepted && !body.locationBlock); } })
    .catch(cause => { if (active) { onReady(false); setError(cause instanceof Error ? cause.message : 'Agreement status unavailable.'); } });
    return () => { active = false; }; }, [onReady]);
  async function accept() {
    if (!checked || busy || status?.locationBlock) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/workspace/trade-agreement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accepted: true, termsVersion: TERMS_VERSION }) });
      const body = await response.json() as Status & { error?: string };
      if (!response.ok) throw Error(body.error ?? 'Could not save your agreement.');
      await load(); setChecked(false);
    } catch (cause) { onReady(false); setError(cause instanceof Error ? cause.message : 'Could not save your agreement.'); }
    finally { setBusy(false); }
  }
  if (status?.accepted && !status.locationBlock) return null;
  return <section className="ws-trade-agreement" aria-label="Before your first real trade">
    <span>BEFORE YOUR FIRST REAL TRADE</span><h2>Review the risks and eligibility.</h2>
    <p className="ws-trade-agreement-note">Only needed for real-money trades. Practice, Markets and Alerts work without it.</p>
    <p>{TRADING_RISK_TEXT}</p><p>{US_RESTRICTION_TEXT} Availability may also be restricted elsewhere. Your confirmation and IP location do not prove legal eligibility.</p>
    <p><a href="/terms" target="_blank" rel="noopener noreferrer">Read the terms ↗</a> · Version {TERMS_VERSION}</p>
    {status?.locationBlock ? <p role="alert">{status.locationBlock}</p> : <><label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)}/>{TRADE_AGREEMENT_LABEL}</label>
      <button type="button" disabled={!checked || busy || !status} onClick={() => void accept()}>{busy ? 'Saving…' : 'Accept and continue'}</button></>}
    {error && <p role="alert">{error} <button type="button" onClick={() => void load().catch(cause => setError(String(cause)))}>Retry</button></p>}
  </section>;
}
