'use client';
import { useState } from 'react';

// The install review: exactly what would be installed onchain, with the complete
// setup-fee table, before anything is signed. Read-only.

type PlanResponse = {
  plan: { perTradeRaw: string; dailyRaw: string; totalRaw: string; expiresAt: number;
    outputs: { symbol: string; token: string }[] };
  summary: { perTrade: string; daily: string; total: string; outputs: string; expires: string };
  ownership: { address: string; verifiedAt: string; method: string | null };
  fees: {
    evidence: { source: string; maxFeePerGasWei: string; ethUpperMicroUsd: string; priceVerified: boolean;
      components: { name: string; gas: string }[] };
    review: { state: string; maximumCents: number; liveQuote: boolean; executionEnabled: boolean };
  };
};

const dollars = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const shorten = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export default function InstallReview() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  async function load() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/workspace/permission/plan', { cache: 'no-store' });
      const payload = await response.json() as PlanResponse & { error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? 'Install review unavailable.');
      setPlan(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Install review unavailable.');
    } finally { setBusy(false); }
  }
  return <section className="ws-install-review">
    <div className="ws-account-head"><div><span className="ws-label">SPENDING PERMISSION / INSTALL REVIEW</span>
      <h3>See exactly what would be installed.</h3>
      <p>Your saved limits become an onchain policy on your verified wallet. This review is read-only — nothing is signed, deployed or spent.</p></div>
      <button type="button" className="ws-recheck" onClick={load} disabled={busy}>{busy ? 'Compiling…' : 'Review the install'}</button></div>
    {error && <p className="ws-error" role="alert">{error}</p>}
    {plan && <div className="ws-install-body">
      <div className="ws-chain-brief"><strong>Your policy, in plain words</strong>
        <p>Owner wallet {shorten(plan.ownership.address)} · verified {new Date(plan.ownership.verifiedAt).toLocaleString()}.</p>
        <p>Each buy stays under <strong>{plan.summary.perTrade}</strong> in USDG. No more than <strong>{plan.summary.daily}</strong> per day, <strong>{plan.summary.total}</strong> across the 30-day policy. Expires {plan.summary.expires}.</p>
        <p>Only these stock tokens may be bought: <strong>{plan.summary.outputs}</strong>. Everything else is rejected onchain — not by a promise, by the permission contract.</p></div>
      <div className="ws-order-events"><span>SETUP FEE REVIEW · {plan.fees.evidence.source === 'isolated-fixture' ? 'LAB GAS ESTIMATES + LIVE GAS PRICE' : 'LIVE QUOTE'}</span>
        {plan.fees.evidence.components.map(component =>
          <div key={component.name}><b>{component.name.replaceAll('_', ' ')}</b><small>{component.gas} gas</small></div>)}
        <div><b>Maximum total</b><small>{dollars(plan.fees.review.maximumCents)} · gas price {plan.fees.evidence.maxFeePerGasWei} wei{plan.fees.evidence.priceVerified ? ' · ETH price verified' : ' · ETH price unverified (review stays pending)'}</small></div></div>
      <div className={`ws-receipt-check ws-partial-${plan.fees.review.state === 'within_cap' ? 'pass' : 'fail'}`}>
        <b>{plan.fees.review.state.toUpperCase().replace('_', ' ')}</b>
        <span><strong>Fee review against your daily limit</strong>
          <small>{plan.fees.review.state === 'within_cap'
            ? `The maximum setup cost (${dollars(plan.fees.review.maximumCents)}) is under your daily buy limit.`
            : plan.fees.review.state === 'over_cap'
              ? `The maximum setup cost (${dollars(plan.fees.review.maximumCents)}) exceeds your daily buy limit. Raise the limit or wait for verified live quotes.`
              : 'Estimates are incomplete (unverified price or fixture gas). The install stays locked until the review passes on verified evidence.'}</small></span></div>
      <p className="ws-chain-note">Signing the install opens with the guarded signer build. Until then this review is the full picture: the exact policy, its expiry, the allowed tokens and the complete setup costs.</p>
    </div>}
  </section>;
}
