'use client';
import { useEffect, useRef, useState } from 'react';
import { matchingWallet, type WalletProvider } from '@/lib/browser-wallet';
import { parsePendingWalletReceipt, pendingReceiptKey } from '@/lib/pending-wallet-receipt';
import { ArrowRight, Clock3 } from 'lucide-react';

// Stage 3: one real order at a time, each prepared server-side, signed in the
// owner's own wallet, and reconciled against exact onchain evidence. The server
// never signs. Every order needs a fresh preparation; quotes expire in seconds.

const dollars = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const tokens = (raw: string) => (Number(BigInt(raw)) / 1e18).toFixed(6);

type Status = { permissionActive: false; blocked?: "activation" | "limits" | "wallet"; detail?: string; safe?: string; mandateVersion?: number } | {
  permissionActive: true; safe: string; symbols: string[];
  perTrade: string; perTradeCents: number; daily: string; total: string;
  balanceCents: number | null;
  latestOrder?: { hash: string; intentDigest: string; state: string } | null;
  holdings?: { symbol: string; tokens: string | null }[];
  filledTodayCents?: number | null; pendingCents?: number | null;
  spentTodayCents: number; remainingTodayCents: number;
};

type Prepared = {
  to: string; data: string; value: string; from: string; intentDigest: string;
  symbol: string; amountCents: number; minimumOutputRaw: string; outputToken: string; expiresAt: string;
};

export default function RealOrderPanel({ provider, address, onOpenMandate }: {
  provider: WalletProvider | null; address: string; onOpenMandate: () => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [symbol, setSymbol] = useState('');
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [intent, setIntent] = useState('');
  const [hash, setHash] = useState('');
  const [outcome, setOutcome] = useState('');
  const [receiptState, setReceiptState] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const recovered = useRef(false);
  const dismissedIntent = useRef('');

  // One automatic recovery: an activated wallet whose module was never recorded
  // is looked up through the wallet connection and recorded, then the status is
  // read again. Runs once; the Refresh button re-arms it.
  async function recover(safe: string) {
    if (!provider || recovered.current) return;
    recovered.current = true;
    setNote('Checking your existing permission…');
    try {
      const checkResponse = await fetch('/api/workspace/permission/install?check=1', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const check = await checkResponse.json() as { staleModule?: string; modules?: string[] };
      const found = checkResponse.ok ? check.staleModule ?? (check.modules?.length === 1 ? check.modules[0] : null) : null;
      if (found) {
        await fetch('/api/workspace/permission/install', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module: found }),
        });
      }
    } catch { /* The locked card below already explains. */ }
    setNote('');
    await loadStatus();
  }

  async function loadStatus() {
    try {
      const response = await fetch('/api/workspace/orders/live/status', { cache: 'no-store', signal: AbortSignal.timeout(25000) });
      const payload = await response.json() as Status & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Order status unavailable.');
      setStatus(payload);
      window.dispatchEvent(new Event('steward-order-updated'));
      if (payload.permissionActive && !hash) {
        let unsaved = null;
        try { unsaved = parsePendingWalletReceipt(sessionStorage.getItem(pendingReceiptKey(payload.safe))); } catch { /* Storage unavailable. */ }
        const latest = unsaved ?? payload.latestOrder;
        if (latest && latest.intentDigest !== dismissedIntent.current) { setHash(latest.hash); setIntent(latest.intentDigest); }
      }
      if (payload.permissionActive && !symbol && payload.symbols.length) setSymbol(payload.symbols[0]);
      if (!payload.permissionActive && payload.blocked === 'activation' && payload.safe) void recover(payload.safe);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Order status unavailable.');
    }
  }
  useEffect(() => { void loadStatus(); }, []);

  async function prepare() {
    if (busy) return;
    setBusy(true); setError(''); setPrepared(null); setIntent(''); setHash(''); setOutcome('');
    try {
      // The amount is fixed, not typed: the permission locks one exact order
      // size, so the page sends that size directly. Anything else is refused.
      const amountCents = status?.permissionActive ? status.perTradeCents : NaN;
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
      if (prepared.from.toLowerCase() !== address.toLowerCase()) throw new Error('Reconnect the wallet that prepared this order.');
      await matchingWallet(provider, address);
      const txHash = await provider.request({ method: 'eth_sendTransaction',
        params: [{ from: address, to: prepared.to, data: prepared.data, value: prepared.value }] }) as string;
      if (!/^0x[0-9a-f]{64}$/i.test(txHash)) throw new Error('Wallet returned no transaction hash.');
      // Keep the sent hash immediately. A failed save must never offer to resend.
      setHash(txHash.toLowerCase()); setPrepared(null);
      if (status?.permissionActive) try { sessionStorage.setItem(pendingReceiptKey(status.safe), JSON.stringify({ hash: txHash, intentDigest: prepared.intentDigest })); } catch { /* Keep in React state. */ }
      const receipt = await fetch('/api/workspace/orders/live/receipt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentDigest: prepared.intentDigest, hash: txHash }),
        signal: AbortSignal.timeout(15000),
      });
      const recorded = await receipt.json() as { error?: string };
      if (!receipt.ok) throw new Error(recorded.error ?? 'The transaction could not be recorded.');
      if (status?.permissionActive) try { sessionStorage.removeItem(pendingReceiptKey(status.safe)); } catch { /* Storage unavailable. */ }
      void loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Order status could not be saved. Check the receipt before doing anything else.');
    } finally { setBusy(false); }
  }

  async function track() {
    if (busy || !intent || !hash) return;
    setBusy(true); setError('');
    if (!receiptState) setReceiptState('checking');
    try {
      const saved = await fetch('/api/workspace/orders/live/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intentDigest: intent, hash }), signal: AbortSignal.timeout(15000) });
      if (!saved.ok) throw new Error('Could not save this receipt yet. Your transaction has already been sent; do not repeat it.');
      if (status?.permissionActive) try { sessionStorage.removeItem(pendingReceiptKey(status.safe)); } catch { /* Storage unavailable. */ }
      const response = await fetch('/api/workspace/orders/live/reconcile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentDigest: intent }),
        signal: AbortSignal.timeout(30000),
      });
      const payload = await response.json() as { outcome?: string; paidUsdg?: string | null; why?: string; error?: string; confirmedFill?: boolean; transactionSucceeded?: boolean; awaitingFinality?: boolean };
      if (!response.ok) throw new Error(payload.error ?? 'Reconciliation unavailable.');
      setReceiptState(payload.outcome === 'verified_fill' ? 'verified' : payload.outcome === 'reverted' ? 'reverted' : payload.confirmedFill ? 'confirmed' : payload.transactionSucceeded ? 'included' : 'checking');
      setOutcome(`${payload.outcome === 'verified_fill' ? 'Purchase verified' : payload.outcome === 'reverted' ? 'Transaction reverted' : payload.confirmedFill ? 'Buy confirmed — finality pending' : payload.transactionSucceeded && payload.awaitingFinality ? 'Transaction succeeded — final verification pending' : 'Verification pending'}${payload.paidUsdg ? ` · paid ${payload.paidUsdg}` : ''}. ${payload.why ?? ''}`);
      void loadStatus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Reconciliation unavailable.');
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!hash || !intent || busy || receiptState === 'verified' || receiptState === 'reverted') return;
    const timer = window.setTimeout(() => { void track(); }, receiptState ? 30000 : 1000);
    return () => window.clearTimeout(timer);
  }, [hash, intent, busy, receiptState]);

  return <section className="ws-install-review" id="ws-real-orders" aria-busy={busy}>
    <div className="ws-account-head"><div><span className="ws-label">REAL ORDERS / PILOT</span>
      <h3>Buy stock tokens.</h3>
      <p>You review and approve every purchase in your wallet.</p></div>
      <button type="button" className="ws-recheck" onClick={() => { recovered.current = false; void loadStatus(); }} disabled={busy}>Refresh</button></div>
    {status?.permissionActive && <p className="ws-chain-note">
      Committed today {dollars(status.spentTodayCents)} (includes pending orders) · {dollars(status.remainingTodayCents)} available in your daily budget.</p>}
    {status?.permissionActive && <div className="ws-live-balances" aria-label="Steward wallet balances"><div><span>USDG available</span><strong>{status.balanceCents === null ? 'Unavailable' : dollars(status.balanceCents)}</strong></div>{status.holdings?.map(holding => <div key={holding.symbol}><span>{holding.symbol} tokens held</span><strong>{holding.tokens === null ? 'Unavailable' : holding.tokens}</strong></div>)}<small>Onchain wallet balances. Pending reservations are budget holds, not additional payments.</small></div>}
    {status?.permissionActive && !hash && <div className="ws-fund-card">
      <span className="ws-label">FUND THIS WALLET</span>
      <p>{status.balanceCents == null
        ? 'Send USDG here before ordering. Keep some ETH in your own wallet for gas.'
        : status.balanceCents >= status.perTradeCents
          ? `Holding ${dollars(status.balanceCents)} — enough for your ${status.perTrade} order. Keep some ETH in your own wallet for gas.`
          : `Holding ${dollars(status.balanceCents)} — send ${dollars(status.perTradeCents - status.balanceCents)} more USDG here, then press Refresh. Keep some ETH in your own wallet for gas.`}</p>
      <div className="ws-fund-row"><code>{status.safe}</code><button type="button" disabled={busy} onClick={async () => { try { await navigator.clipboard.writeText(status.safe); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setError('Could not copy the address. Select and copy it manually.'); } }}>{copied ? 'Copied' : 'Copy'}</button></div></div>}
    {status && !status.permissionActive && status.blocked === "limits" && <div className="ws-order-plan ws-order-blocked" role="status">
      <div className="ws-order-blocked-heading"><span className="ws-order-blocked-icon"><Clock3 size={20} aria-hidden="true" /></span><div><span className="ws-label">ORDER PAUSED</span><strong>{/window ended|expired/i.test(status.detail??'')?'Your permission has expired':'Your limits need an update'}</strong><p>{/window ended|expired/i.test(status.detail??'') ? 'The saved limits above are a proposal for a new permission. They have not extended the old one.' : status.detail ?? 'Review and save your purchase limits before ordering.'}</p></div></div>
      <div className="ws-order-blocked-next"><div><span>1</span> Save a new mandate version</div><div><span>2</span> Approve the new permission in your wallet</div></div>
      <button type="button" className="ws-action-primary" onClick={onOpenMandate} disabled={busy}>Update Mandate <ArrowRight size={16} aria-hidden="true" /></button></div>}
    {status && !status.permissionActive && status.blocked === "wallet" && <p className="ws-chain-note">Verify your wallet just above, then press Refresh on this card.</p>}
    {status && !status.permissionActive && status.blocked !== "limits" && status.blocked !== "wallet" && <p className="ws-chain-note">{status.detail ?? 'Turn on the permission above first. Real orders stay locked until activation is verified.'}</p>}
    {note && <p className="ws-chain-note" role="status">{note}</p>}
    {status?.permissionActive && !prepared && !hash && <div className="ws-check-fields ws-order-fields">
      <label>Stock<select value={symbol} onChange={(event) => setSymbol(event.target.value)}>{status.symbols.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Pay · USD, fixed by your permission<input value={(status.perTradeCents / 100).toFixed(2)} readOnly aria-readonly="true" /></label>
      <button type="button" onClick={prepare} disabled={busy || !provider}>Prepare exact order</button></div>}
    {!provider && !hash && !(status && !status.permissionActive && status.blocked === 'limits') && <p className="ws-chain-note">Connect your wallet above when you want to place an order. <button type="button" className="ws-recheck" onClick={() => document.getElementById('ws-wallet-orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Go to wallet setup</button></p>}
    {prepared && <div className="ws-order-plan">
      <span>EXACT ORDER · SIGN WITHIN SECONDS</span>
      <strong>Pay {dollars(prepared.amountCents)} for at least {tokens(prepared.minimumOutputRaw)} {prepared.symbol}</strong>
      <p>The quote expires in seconds. Review the figures, then sign in your wallet. Nothing moves until you sign.</p>
      <button type="button" className="ws-action-primary" onClick={sign} disabled={busy}>{busy ? 'Working…' : 'Sign in wallet'}</button>
      <button type="button" className="ws-action-quiet" onClick={() => setPrepared(null)} disabled={busy}>Discard</button></div>}
    {hash && <div className="ws-order-events"><span>{receiptState === 'verified' ? 'PURCHASE FINALIZED' : receiptState === 'confirmed' ? 'BUY CONFIRMED · FINALITY PENDING' : receiptState === 'included' ? 'TRANSACTION SUCCEEDED · CHECKING RECEIPT' : receiptState === 'reverted' ? 'TRANSACTION REVERTED' : 'SENT · VERIFYING'}</span>
      <div><b>{receiptState === 'confirmed' ? 'Stock-token purchase confirmed' : receiptState === 'included' ? 'Transaction succeeded onchain' : receiptState === 'verified' ? 'Receipt verified' : receiptState === 'reverted' ? 'No purchase completed' : 'Transaction recorded'}</b><small>{hash.slice(0, 18)}…</small></div>
      <a className="ws-recheck" href={`https://robinhoodchain.blockscout.com/tx/${hash}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a>
      <p className="ws-chain-note">No additional funds are needed for this submitted order.</p>
      {receiptState!=='verified'&&<button type="button" className="ws-transaction-check" onClick={track} disabled={busy}>{busy ? 'Checking transaction…' : 'Check this transaction'}</button>}</div>}
    {hash && (receiptState === 'verified' || receiptState === 'reverted') && <button type="button" className="ws-action-secondary" disabled={busy} onClick={() => { dismissedIntent.current = intent; setHash(''); setIntent(''); setReceiptState(''); setOutcome(''); }}>Review another order</button>}
    {outcome && <p className="ws-chain-brief" role="status">{outcome}</p>}
    {error && <div className="ws-toast-wrap" role="alert"><div className="ws-toast"><p>{error}</p><button type="button" onClick={() => setError('')}>Dismiss</button></div></div>}
  </section>;
}
