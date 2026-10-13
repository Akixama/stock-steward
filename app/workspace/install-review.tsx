'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletProvider } from '@/lib/browser-wallet';
import InstallDriver from './install-driver';
import { PermissionReviewDetails } from './permission-design';

// The activation review: exactly what would be turned on for your wallet onchain,
// with the complete setup-fee table in dollars, before anything is signed. Read-only.

export type PlanResponse = {
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


export default function InstallReview({ provider, address, policyVersion, onOpenMandate }: {
  provider: WalletProvider | null; address: string; policyVersion: number; onOpenMandate: () => void;
}) {
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const generation=useRef(0);
  const load=useCallback(async () => {
    const ticket=++generation.current;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/workspace/permission/plan', { cache: 'no-store' });
      const payload = await response.json() as PlanResponse & { error?: string };
      if(ticket!==generation.current)return;
      if (!response.ok || !payload.plan) throw new Error(payload.error ?? 'Activation review unavailable.');
      setPlan(payload);
    } catch (cause) {
      if(ticket===generation.current){setPlan(null);setError(cause instanceof Error ? cause.message : 'Activation review unavailable.');}
    } finally { if(ticket===generation.current)setBusy(false); }
  },[]);
  useEffect(() => { generation.current++;const timer = setTimeout(() => {setPlan(null);void load();}, 0); return () => {clearTimeout(timer);generation.current++;}; }, [policyVersion,address,provider,load]);
  useEffect(()=>{const changed=()=>{void load();};window.addEventListener('stock-steward:ownership-changed',changed);return()=>window.removeEventListener('stock-steward:ownership-changed',changed);},[load]);
  const needsLimits = /mandate|limits|symbol|token contract/i.test(error);
  const needsWallet = /ownership|verify your wallet/i.test(error);
  const step = needsLimits
    ? { n: '1', title: 'Set your limits first', why: 'There is nothing to turn on until your limits are saved.', action: 'Open Mandate', go: onOpenMandate }
    : needsWallet
      ? { n: '2', title: 'Prove the wallet is yours', why: 'A free signature proves you control it. Activation needs that proof first.', action: 'Verify wallet', go: () => document.getElementById('ws-wallet-setup')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth', block: 'start' }) }
      : null;
  return <section className="ws-install-review" id="ws-activation">
    <div className="ws-account-head"><div><span className="ws-label">PERMISSION / REVIEW</span>
      <h3>Review your trading limits.</h3>
      <p>Check your limits and estimated fees before approving setup.</p></div>
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
      <PermissionReviewDetails plan={plan} />
      <div className="ws-permission-explainer" role="note"><strong>What activation allows</strong><p>Buy {plan.summary.outputs} stock tokens, up to {plan.summary.perTrade} each and {plan.summary.daily} per day, with {plan.summary.total} across two days, until {plan.summary.expires}.</p><p>It cannot withdraw funds, trade other assets or exceed these limits. Use Permission controls below to turn it off.</p></div>
      <InstallDriver provider={provider} address={address} policyVersion={policyVersion} feesOk={plan.fees.review.state === 'within_cap'} expires={plan.summary.expires} />
    </div>}
  </section>;
}
