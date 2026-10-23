"use client";
import {formatWorkspaceDate} from '@/lib/workspace-date';

import { useEffect, useRef, useState } from "react";
import { useWalletSession } from './wallet-session';
import BridgeDialog from './bridge-dialog';
import { CHAIN } from "@/lib/robinhood-chain";
import type { PricedObservation } from "@/lib/chain-analysis";
import type { Mandate } from "@/lib/decision";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const shorten = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const when = (s: string) => formatWorkspaceDate(s);
function usdMicro(value: string) {
  const n = BigInt(value), cents = n / 10000n;
  return `$${(cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(cents % 100n).toString().padStart(2, "0")}`;
}
// Small Help section on Home: balances, funding and details for the connected wallet only.
export default function ChainPanel({ mandate: _mandate }: { mandate: Mandate }) {
  const session = useWalletSession();
  const address = session?.address ?? "";
  const [snapshot, setSnapshot] = useState<PricedObservation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => { generation.current++; const timer = setTimeout(() => { setSnapshot(null); setError(null); }, 0); return () => clearTimeout(timer); }, [address]);
  async function read() {
    if (!address) return;
    const ticket = ++generation.current; setBusy(true); setError(null);
    try {
      const response = await fetch("/api/workspace/chain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }), cache: "no-store" });
      const data = await response.json() as { observation?: PricedObservation; error?: string };
      if (!response.ok || !data.observation) throw new Error(data.error ?? "Balances unavailable.");
      if (ticket === generation.current) setSnapshot(data.observation);
    } catch (e) { if (ticket === generation.current) setError(e instanceof Error ? e.message : "Balances unavailable."); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  return <section id="ws-chain-panel" className="ws-check-panel ws-chain-panel" aria-busy={busy}>
    <div className="ws-account-head"><div><span className="ws-label">HELP</span><h2>Wallet help</h2>
      <p>{address ? `Balances and funding for ${shorten(address)}.` : "Connect your wallet on Home to see balances here."}</p></div>
      {address && <button className="ws-recheck" onClick={() => void read()} disabled={busy}>{busy ? "Checking…" : "Check balances"}</button>}</div>
    <details className="ws-chain-fund">
      <summary>Add funds to Robinhood Chain</summary>
      <p>Use USDG to buy stock tokens and ETH to pay network fees.</p>
      <BridgeDialog provider={session?.provider ?? null} address={address} />
      <div className="ws-chain-fund-options">
        <span className="ws-label">PREFER ANOTHER APP?</span>
        <a className="ws-recheck" target="_blank" rel="noreferrer" href={`https://jumper.exchange/?toChain=4663&toToken=${USDG}${address ? `&toAddress=${address}` : ""}`}>Bridge with Jumper ↗</a>
        <a className="ws-recheck" target="_blank" rel="noreferrer" href={`https://relay.link/bridge?toChainId=4663&toCurrency=${USDG}${address ? `&toAddress=${address}` : ""}`}>Bridge with Relay ↗</a>
        <a className="ws-recheck" target="_blank" rel="noreferrer" href="https://docs.robinhood.com/chain/bridging/">Official bridging guide ↗</a>
      </div>
      <small>Got another token? Swap it to USDG, then check balances.</small>
    </details>
    {error && <p className="ws-error" role="alert">{error}</p>}
    {snapshot && <div className="ws-account-evidence">
      <span className="ws-label">{shorten(snapshot.address)} · CHECKED {when(snapshot.observedAt)}</span>
      <div className="ws-account-numbers ws-account-numbers-four">
        <div><span>ETH · network fees</span><strong title={snapshot.eth+' ETH'}>{snapshot.eth.split('.')[0]}{snapshot.eth.includes('.')?'.'+snapshot.eth.split('.')[1].slice(0,4):''}</strong></div>
        <div><span>USDG · to buy</span><strong>{snapshot.usdg == null ? '—' : snapshot.usdg.includes('.') ? snapshot.usdg.split('.')[0] + '.' + snapshot.usdg.split('.')[1].slice(0, 2).padEnd(2, '0') : snapshot.usdg}</strong></div>
        <div><span>Stock holdings</span><strong>{snapshot.holdings.length}</strong></div>
        <div><span>Stock value · estimated</span><strong>{usdMicro(snapshot.subtotalMicroUsd)}</strong></div></div>
      {snapshot.alerts.length > 0 && <ul className="ws-alert-list">{snapshot.alerts.map((alert, i) => <li key={i}>{alert}</li>)}</ul>}
      <details className="ws-chain-evidence"><summary>Technical details</summary>
        <dl className="ws-evidence-table">
          <div><dt>Wallet</dt><dd>{snapshot.address} · Chain {snapshot.chainId}</dd></div>
          <div><dt>Block</dt><dd><a href={`${CHAIN.explorer}/block/${BigInt(snapshot.block).toString()}`} target="_blank" rel="noreferrer">{BigInt(snapshot.block).toString()}</a></dd></div>
          {snapshot.holdings.map(holding => <div key={holding.contract}><dt>{holding.symbol}</dt><dd>{holding.quantity ?? "Amount unknown"} tokens · <a href={`${CHAIN.explorer}/address/${holding.contract}`} target="_blank" rel="noreferrer">{shorten(holding.contract)}</a></dd></div>)}
        </dl></details>
    </div>}
  </section>;
}
