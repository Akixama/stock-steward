'use client';
import { useEffect, useState } from 'react';
import type { WalletProvider } from '@/lib/browser-wallet';

// Stage 3: one real order at a time, each prepared server-side, signed in the
// owner's own wallet, and reconciled against exact onchain evidence. The server
// never signs. Every order needs a fresh preparation; quotes expire in seconds.

const dollars = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const tokens = (raw: string) => (Number(BigInt(raw)) / 1e18).toFixed(6);

type Status = { permissionActive: false } | {
  permissionActive: true; safe: string; symbols: string[];
  perTrade: string; daily: string; total: string;
  spentTodayCents: number; remainingTodayCents: number;
};

type Prepared = {
  to: string; data: string; value: string; from: string; intentDigest: string;
  symbol: string; amountCents: number; minimumOutputRaw: string; outputToken: string; expiresAt: string;
};

export default function RealOrderPanel({ provider, address }: {
  provider: WalletProvider | null; address: string;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [symbol, setSymbol] = useState('');
  const [amount, setAmount] = useState('1.00');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [intent, setIntent] = useState('');
  const [hash, setHash] = useState('');
  const [outcome, setOutcome] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadStatus() {
    try {
      const response = await fetch('/api/workspace/orders/live/status', { cache: 'no-store' });
      const payload = await response.json() as Status & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Order status unavailable.');
      setStatus(payload);
      if (payload.permissionActive && !symbol && payload.symbols.length) setSymbol(payload.symbols[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Order status unavailable.');
    }
  }
  useEffect(() => { void loadStatus(); }, []);

  async function prepare() {
    if (busy) return;
    setBusy(true); setError(''); setPrepared(null); setIntent(''); setHash(''); setOutcome('');
    try {
      const amountCents = Math.round(Number(amount) * 100);
      const response = await fetch('/api/workspace/orders/live/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, amountCents }),
      });
      const payload = await response.json() as Prepared & { error?: string };
      if (!response.ok || !payload.intentDigest) throw new Error(payload.error ?? 'Order preparation unavailable.');
      setPrepared(payload);
      setIntent(payload.intentDigest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Order preparation unavailable.');
    } finally { setBusy(false); }
  }

  async function sign() {
    if (!provider || !prepared || busy) return;
    if (Date.now() > Date.parse(prepared.expiresAt) - 3000) {
      setError('That quote expired. Prepare the order again for a fresh price.');
      setPrepared(null);
      return;
    }
    setBusy(true); setError('');
    try {
      const txHash = await provider.request({ method: 'eth_sendTransaction',
        params: [{ from: address, to: prepared.to, data: prepared.data, value: prepared.value }] }) as string;
      if (!/^0x[0-9a-f]{64}$/i.test(txHash)) throw new Error('Wallet returned no transaction hash.');
      const receipt = await fetch('/api/workspace/orders/live/receipt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentDigest: prepared.intentDigest, hash: txHash }),
      });
      const recorded = await receipt.json() as { error?: string };
      if (!receipt.ok) throw new Error(recorded.error ?? 'The transaction could not be recorded.');
      setHash(txHash.toLowerCase());
      setPrepared(null);
      void loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Signing did not complete.');
    } finally { setBusy(false); }
  }

  async function track() {
    if (busy || !intent) return;
    setBusy(true); setError(''); setOutcome('');
    try {
      const response = await fetch('/api/workspace/orders/live/reconcile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentDigest: intent }),
      });
      const payload = await response.json() as { outcome?: string; paidUsdg?: string | null; why?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Reconciliation unavailable.');
      setOutcome(`${payload.outcome === 'verified_fill' ? 'Confirmed' : payload.outcome === 'reverted' ? 'Reverted' : 'Not yet provable'}${payload.paidUsdg ? ` · paid ${payload.paidUsdg}` : ''}. ${payload.why ?? ''}`);
      void loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reconciliation unavailable.');
    } finally { setBusy(false); }
  }

  return <section className="ws-install-review" aria-busy={busy}>
    <div className="ws-account-head"><div><span className="ws-label">REAL ORDERS / PILOT</span>
      <h3>Buy for real, one order at a time.</h3>
      <p>Each order is prepared fresh, signed by you in your wallet, and verified onchain afterwards. The server can never sign or spend.</p></div>
      <button type="button" className="ws-recheck" onClick={loadStatus} disabled={busy}>Refresh</button></div>
    {status?.permissionActive && <p className="ws-chain-note">
      Spent today {dollars(status.spentTodayCents)} · {dollars(status.remainingTodayCents)} left of your daily limit · pilot caps {status.perTrade} a trade, {status.daily} a day, {status.total} total.</p>}
    {status?.permissionActive && <p className="ws-chain-note">
      Fund this Steward wallet address with USDG before ordering: {status.safe} <button type="button" className="ws-recheck" disabled={busy} onClick={() => { try { void navigator.clipboard.writeText(status.safe); } catch { /* Clipboard unavailable. */ } }}>Copy address</button></p>}
    {status && !status.permissionActive && <p className="ws-chain-note">Turn on the permission above first. Real orders stay locked until activation is verified.</p>}
    {status?.permissionActive && !prepared && !hash && <div className="ws-check-fields">
      <label>Stock<select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{status.symbols.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Pay · USD<input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="1.00" /></label>
      <button type="button" onClick={prepare} disabled={busy || !provider}>Prepare exact order</button></div>}
    {!provider && <p className="ws-chain-note">Connect and verify your wallet above to prepare orders.</p>}
    {prepared && <div className="ws-order-plan">
      <span>EXACT ORDER · SIGN WITHIN SECONDS</span>
      <strong>Pay {dollars(prepared.amountCents)} for at least {tokens(prepared.minimumOutputRaw)} {prepared.symbol}</strong>
      <p>The quote expires in seconds. Review the figures, then sign in your wallet. Nothing moves until you sign.</p>
      <button type="button" className="ws-action-primary" onClick={sign} disabled={busy}>{busy ? 'Working…' : 'Sign in wallet'}</button>
      <button type="button" className="ws-action-quiet" onClick={() => setPrepared(null)} disabled={busy}>Discard</button></div>}
    {hash && <div className="ws-order-events"><span>SENT · VERIFYING</span>
      <div><b>Transaction recorded</b><small>{hash.slice(0, 18)}… · nothing is assumed until the receipt is verified</small></div>
      <button type="button" className="ws-action-primary" onClick={track} disabled={busy}>{busy ? 'Checking…' : 'Track receipt'}</button></div>}
    {outcome && <p className="ws-chain-brief" role="status">{outcome}</p>}
    {error && <p className="ws-error" role="alert">{error}</p>}
  </section>;
}
