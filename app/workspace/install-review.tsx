'use client';
import { useEffect, useState } from 'react';
import type { WalletProvider } from '@/lib/browser-wallet';
import InstallDriver from './install-driver';

// The activation review: exactly what would be turned on for your wallet onchain,
// with the complete setup-fee table in dollars, before anything is signed. Read-only.

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

export default function InstallReview({ provider, address, policyVersion, onOpenMandate }: {
  provider: WalletProvider | null; address: string; policyVersion: number; onOpenMandate: () => void;
}) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  async function load() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/workspace/permission/plan', { cache: 'no-store' });
      const payload = await response.json() as PlanResponse & { error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? 'Activation review unavailable.');
      setPlan(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Activation review unavailable.');
    } finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  const needsLimits = /mandate|limits|symbol|token contract/i.test(error);
  const needsWallet = /ownership|verify your wallet/i.test(error);
  const step = needsLimits
    ? { n: '1', title: 'Set your limits first', why: 'Activation puts your saved limits onchain — with nothing saved, there is nothing to turn on.', action: 'Open Mandate', go: onOpenMandate }
    : needsWallet
      ? { n: '2', title: 'Prove the wallet is yours', why: 'Connecting only shows an address; a free signature proves you control it. Activation needs that proof first.', action: 'Verify wallet', go: () => document.getElementById('ws-ownership')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
      : null;
  return <section className="ws-install-review">
    <div className="ws-account-head"><div><span className="ws-label">SPENDING PERMISSION / ACTIVATION REVIEW</span>
      <h3>See exactly what would be turned on.</h3>
      <p>Your saved limits become an onchain policy on your verified wallet. This review is read-only — nothing is signed, deployed or spent.</p></div>
      {plan && <button type="button" className="ws-recheck" onClick={load} disabled={busy}>{busy ? 'Compiling…' : 'Refresh review'}</button>}</div>
    {busy && !plan && <p className="ws-chain-note">Checking what is ready…</p>}
    {!busy && step && <div className="ws-install-gate">
      <span className="ws-label">STEP {step.n} OF 2</span>
      <strong>{step.title}</strong>
      <p>{step.why}</p>
      <button type="button" className="ws-action-primary" onClick={step.go}>{step.action}</button>
    </div>}
    {!busy && error && !step && <p className="ws-error" role="alert">{error}</p>}
    {plan && <div className="ws-install-body">
      <div className="ws-chain-brief"><strong>Your policy, in plain words</strong>
        <p>Wallet {shorten(plan.ownership.address)} · under {plan.summary.perTrade} a buy, {plan.summary.daily} a day · {plan.summary.outputs} only · ends {plan.summary.expires}.</p>
        <details><summary>Full wording</summary>
          <p>Owner wallet {shorten(plan.ownership.address)} · verified {new Date(plan.ownership.verifiedAt).toLocaleString()}.</p>
          <p>Each buy stays under <strong>{plan.summary.perTrade}</strong> in USDG. No more than <strong>{plan.summary.daily}</strong> per day, <strong>{plan.summary.total}</strong> across the 2-day policy. Expires {plan.summary.expires}.</p>
          <p>Only these stock tokens may be bought: <strong>{plan.summary.outputs}</strong>. Everything else is rejected onchain — not by a promise, by the permission contract.</p></details></div>
      <div className={`ws-receipt-check ws-partial-${plan.fees.review.state === 'within_cap' ? 'pass' : 'fail'}`}>
        <b>{plan.fees.review.state.toUpperCase().replace('_', ' ')}</b>
        <span><strong>Setup cost {dollars(plan.fees.review.maximumCents)} · {plan.fees.review.state === 'within_cap'
          ? 'under your daily limit'
          : plan.fees.review.state === 'over_cap' ? 'over your daily limit' : 'still estimating'}</strong>
          <details><summary>Fee breakdown</summary>
            {plan.fees.evidence.components.map(component =>
              <div key={component.name}><b>{component.name.replaceAll('_', ' ')}</b><small>Included</small></div>)}
            <div><b>Maximum total</b><small>{dollars(plan.fees.review.maximumCents)} maximum setup cost{plan.fees.evidence.priceVerified ? ' · live quote' : ' · awaiting live quote (review stays pending)'}</small></div>
            <small>{plan.fees.review.state === 'within_cap'
              ? `The maximum setup cost (${dollars(plan.fees.review.maximumCents)}) is under your daily buy limit.`
              : plan.fees.review.state === 'over_cap'
                ? `The maximum setup cost (${dollars(plan.fees.review.maximumCents)}) exceeds your daily buy limit. Raise the limit or wait for verified live quotes.`
                : 'Estimates are incomplete (unverified price or fixture gas). The install stays locked until the review passes on verified evidence.'}</small></details></span></div>
      <InstallDriver provider={provider} address={address} policyVersion={policyVersion} />
    </div>}
  </section>;
}
