"use client";
import { useState } from "react";
import type { AccountView } from "@/lib/anytime";
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
export default function AccountPanel() {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function refresh() {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/workspace/account", { cache: "no-store" });
      const result = await response.json() as { account?: AccountView; error?: string };
      if (!response.ok || !result.account) throw new Error(result.error ?? "Account unavailable.");
      setAccount(result.account);
    } catch (e) { setError(e instanceof Error ? e.message : "Account unavailable."); }
    finally { setLoading(false); }
  }
  return <section className="ws-check-panel ws-account-panel"><div className="ws-account-head"><div><span className="ws-label">YOUR ACCOUNT / ANYTIME</span><h2>See where you stand.</h2><p>Read balances, positions and open orders, even outside the regular session. This view sends no order.</p></div><button className="ws-recheck" onClick={refresh} disabled={loading}>{loading ? "Reading Alpaca…" : account ? "Refresh account" : "Read my account"}</button></div>
    {error && <p className="ws-error" role="alert">{error}{account && " The previous observation below has not been refreshed."}</p>}
    {account && <div className="ws-account-evidence"><span className="ws-label">{account.environment.toUpperCase()} BROKER RESPONSE · {account.marketOpen ? "REGULAR SESSION OPEN" : "REGULAR SESSION CLOSED"}</span><p>Retrieved {new Date(account.observedAt).toLocaleString()} · Account {account.accountStatus}. Broker valuations can reflect the last session; retrieval time is not a fresh-price timestamp.</p><div className="ws-account-numbers"><div><span>Account equity</span><strong>{usd(account.equityCents)}</strong></div><div><span>Cash</span><strong>{usd(account.cashCents)}</strong></div><div><span>Funds available without margin</span><strong>{usd(account.availableCashCents)}</strong></div></div>{!account.marketOpen && <p>Next regular session: {new Date(account.nextOpen).toLocaleString()} (your device time). Refresh to confirm status; no background monitoring is running.</p>}
    <details><summary>Positions · {account.positions.length}</summary>{account.positions.length ? account.positions.map(p => <p key={p.symbol}>{p.symbol} · Broker valuation {usd(p.valueCents)}</p>) : <p>No positions returned by Alpaca.</p>}</details>
    <details><summary>Open orders · {account.orders.length}{!account.ordersComplete && " · list may be incomplete"}</summary>{account.orders.length ? account.orders.map((o, i) => <p key={i}>{o.side.toUpperCase()} {o.symbol} · {o.status} · {o.notionalCents === null ? "Quantity order; dollar exposure not inferred" : `${usd(o.notionalCents)} original notional; remaining exposure not inferred`}</p>) : <p>No open orders returned by Alpaca.</p>}</details></div>}
  </section>;
}
