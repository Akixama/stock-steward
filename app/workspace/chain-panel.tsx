"use client";
import { useEffect, useRef, useState } from "react";
import WalletConnect from './wallet-connect';
import { useWalletSession, shareWalletSession } from './wallet-session';
import LifiBridge from './lifi-bridge';
import { CHAIN } from "@/lib/robinhood-chain";
import { compareObservations, purchasePreview, parseUsdCents, type PricedObservation, type Preview } from "@/lib/chain-analysis";
import type { Mandate } from "@/lib/decision";

const valid = (s: string) => /^0x[0-9a-f]{40}$/i.test(s);
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const shorten = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const when = (s: string) => new Date(s).toLocaleString();
function usdMicro(value: string) {
  const n = BigInt(value), cents = n / 10000n;
  return `$${(cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(cents % 100n).toString().padStart(2, "0")}`;
}
export default function ChainPanel({ mandate }: { mandate: Mandate }) {
  const session = useWalletSession();
  const connected = !!session;
  const [address, setAddress] = useState("");
  const [snapshot, setSnapshot] = useState<PricedObservation | null>(null);
  const [history, setHistory] = useState<PricedObservation[]>([]);
  const [previous, setPrevious] = useState<PricedObservation | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contract, setContract] = useState("");
  const [amount, setAmount] = useState("1.00");
  const generation = useRef(0);
  function clear() {
    generation.current++; setSnapshot(null); setPrevious(null);
    setAddress(""); setBusy(false); setError(null); setNotice(null); setContract("");
  }
  // One wallet connection is shared with every panel. A wallet that joined in
  // Autonomy (or anywhere) appears here immediately; a wallet-level account
  // change drops the session and returns the panel to watch-only.
  const sessionAddress = session?.address ?? "";
  const lastSessionAddress = useRef("");
  useEffect(() => {
    if (sessionAddress) {
      setAddress(sessionAddress); setSnapshot(null); setPrevious(null);
      setNotice("Wallet connected. Observe & save reads its holdings at one block.");
    } else if (lastSessionAddress.current) {
      setSnapshot(null); setPrevious(null); setAddress(lastSessionAddress.current);
      setNotice("Wallet account changed or was disconnected. Saved receipts remain; observe again to read the current state.");
    }
    lastSessionAddress.current = sessionAddress;
  }, [sessionAddress]);
  useEffect(() => { if (!snapshot) return; const timer = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(timer); }, [snapshot]);
  const historical = snapshot ? clock - Date.parse(snapshot.observedAt) > 120000 : false;
  async function loadHistory(ticket: number, target?: string) {
    const response = await fetch(`/api/workspace/chain${target ? `?address=${encodeURIComponent(target)}` : ""}`, { cache: "no-store" });
    const data = await response.json() as { records?: PricedObservation[]; error?: string };
    if (!response.ok || !data.records) throw new Error(data.error ?? "History unavailable.");
    if (ticket === generation.current) setHistory(data.records);
  }
  async function historyClick() {
    const ticket = ++generation.current; setBusy(true); setError(null);
    try { await loadHistory(ticket, valid(address) ? address : undefined); }
    catch (e) { if (ticket === generation.current) setError(e instanceof Error ? e.message : "History unavailable."); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  async function read() {
    const ticket = ++generation.current; setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/workspace/chain", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }), cache: "no-store" });
      const data = await response.json() as { observation?: PricedObservation; saved?: boolean; error?: string; warning?: string };
      if (!response.ok || !data.observation) throw new Error(data.error ?? "Observation unavailable.");
      if (ticket !== generation.current) return;
      const record = data.observation;
      setPrevious(snapshot?.address === record.address ? snapshot : history.find(h => h.address === record.address) ?? null);
      setSnapshot(record); setContract(record.holdings[0]?.contract ?? "");
      setNotice(data.saved ? "Observation saved in your signed-in workspace. Wallet ownership is not verified." : data.warning ?? "Evidence was not saved.");
      if (data.saved) {
        try { await loadHistory(ticket, record.address); }
        catch { if (ticket === generation.current) setNotice("Observation saved, but history could not be refreshed."); }
      }
    } catch (e) { if (ticket === generation.current) setError(e instanceof Error ? e.message : "Observation unavailable."); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  let preview: Preview | null = null;
  const amountCents = parseUsdCents(amount) ?? NaN;
  if (snapshot && contract && mandate.version && Number.isSafeInteger(amountCents) && amountCents > 0) {
    try { preview = purchasePreview(snapshot, contract, amountCents, mandate); } catch { /* Invalid input shows no checks. */ }
  }
  return <section id="ws-chain-panel" className="ws-check-panel ws-chain-panel" aria-busy={busy}>
    <div className="ws-account-head"><div><span className="ws-label">ROBINHOOD CHAIN / WALLET STEWARD</span><h2>Your wallet. In focus.</h2>
      <p>Observe real holdings, inspect indicative prices and keep the evidence. No signature, gas or trading permission is requested.</p></div>
      {connected?<button className="ws-recheck" onClick={()=>{clear();shareWalletSession(null);setNotice("Disconnected. Saved receipts remain; you can still watch any address.");}} disabled={busy}>Disconnect from Steward</button>:<WalletConnect disabled={busy} onConnected={(p,address)=>{clear();setAddress(address);setNotice("Wallet connected. Observe & save reads its holdings at one block.");}}/>}</div>
    <div className="ws-check-fields"><label>Public address · ownership unverified<input value={address} disabled={busy} onChange={e => {
      generation.current++; setAddress(e.target.value.trim()); setSnapshot(null); setPrevious(null); setNotice(null);
    }} placeholder="0x…" spellCheck={false} /></label>
      <button onClick={read} disabled={busy || !valid(address)}>{busy ? "Reading evidence…" : "Observe & save"}</button></div>
    <div className="ws-chain-tools"><button className="ws-recheck" onClick={historyClick} disabled={busy}>Load saved observations</button>
      <span>Robinhood mainnet 4663 · reads limited to once per 15 seconds</span></div>
    <p className="ws-chain-note">Watch-only addresses are supported. Saved records belong to your site login, not proof of wallet ownership. Disconnecting clears the current view; saved records remain.</p>
    <details className="ws-chain-fund">
      <summary>Get funds onto Robinhood Chain</summary>
      <p>Bring USDG (the chain's dollar) and a little ETH for gas. The bridge settles straight to your wallet — Stock Steward never holds your funds.</p>
      <LifiBridge address={address} />
      <div className="ws-chain-fund-options">
        <span className="ws-label">PREFER ANOTHER APP?</span>
        <a className="ws-recheck" target="_blank" rel="noreferrer"
          href={`https://jumper.exchange/?toChain=4663&toToken=${USDG}${valid(address) ? `&toAddress=${address}` : ""}`}>Bridge with Jumper ↗</a>
        <a className="ws-recheck" target="_blank" rel="noreferrer"
          href={`https://relay.link/bridge?toChainId=4663&toCurrency=${USDG}${valid(address) ? `&toAddress=${address}` : ""}`}>Bridge with Relay ↗</a>
        <a className="ws-recheck" target="_blank" rel="noreferrer" href="https://docs.robinhood.com/chain/bridging/">Official bridging guide ↗</a>
      </div>
      <small>Arriving with USDC or another token? Swap to USDG in the same bridge app after it lands. Then press Observe & save here.</small>
    </details>
    {error && <p className="ws-error" role="alert">{error}{snapshot && " Previous evidence below was not refreshed."}</p>}
    {notice && <p className="ws-chain-brief" role="status">{notice}</p>}
    {snapshot && <div className="ws-account-evidence">
      <span className="ws-label">{shorten(snapshot.address)} · OBSERVED {when(snapshot.observedAt)}</span>
      <div className="ws-account-numbers"><div><span>ETH on Robinhood Chain</span><strong title={snapshot.eth+' ETH'}>{snapshot.eth.split('.')[0]}{snapshot.eth.includes('.')?'.'+snapshot.eth.split('.')[1].slice(0,4):''}</strong><small>ETH · used for network fees. Exact balance in evidence.</small></div>
        <div><span>Supported stock holdings</span><strong>{snapshot.holdings.length}</strong><small>{snapshot.pricedCount} of {snapshot.holdings.length} holdings have indicative prices.</small></div>
        <div><span>{historical ? "Historical stock value" : "Estimated stock value"}</span><strong>{usdMicro(snapshot.subtotalMicroUsd)}</strong><small>Supported stocks only · excludes ETH and other assets.</small></div></div>
      <div className="ws-chain-brief"><strong>What needs attention</strong>{snapshot.alerts.map((alert, i) => <p key={i}>{alert}</p>)}</div>
      {previous && <div className="ws-chain-brief"><strong>What changed since {when(previous.observedAt)}</strong>{compareObservations(snapshot, previous).map((line, i) => <p key={i}>{line}</p>)}</div>}
      <div className="ws-chain-holdings">{snapshot.holdings.length ? snapshot.holdings.map(holding => {
        const price = snapshot.prices[holding.contract];
        return <details key={holding.contract}><summary><strong>{holding.symbol}</strong><span>{holding.quantity ?? "Amount unknown"} tokens · {price?.valueMicroUsd !== null && price?.valueMicroUsd !== undefined ? usdMicro(price.valueMicroUsd) : "Unpriced"}</span></summary>
          <p>Registry status: {holding.status}. This is not a trading-eligibility check.</p>
          <p>Contract <a href={`${CHAIN.explorer}/address/${holding.contract}`} target="_blank" rel="noreferrer">{holding.contract}</a></p>
          <p>Raw balance {holding.raw} · Decimals {holding.decimals ?? "unknown"} · Shares-per-token multiplier {holding.multiplier ?? "unknown"}</p>
          <p>State when observed: {price?.state ?? "unavailable"} · Generated {price?.generatedAt ? when(price.generatedAt) : "unknown"}</p>
          <p>Underlying bid / ask: {price?.bid ?? "—"} / {price?.ask ?? "—"} USD.</p><p>{price?.reason}</p>
        </details>;
      }) : <p>{snapshot.failures ? "No positive holdings confirmed in the successful reads; coverage is incomplete." : "No supported stock tokens held at the observed block."}</p>}</div>
      {snapshot.holdings.length > 0 && <div className="ws-chain-preview"><span className="ws-label">WHAT IF / HYPOTHETICAL PURCHASE</span><h3>Check before you act.</h3>
        <p>Would this purchase fit your saved rules? Choose a holding and enter an amount to preview the checks. Uses saved mandate v{mandate.version || "—"}; save any changes in Mandate first.</p><p>A failed check blocks the proposal. Pending means more evidence is needed. Passing individual checks does not authorize a trade.</p>
        <div className="ws-check-fields"><label>Observed stock token<select value={contract} onChange={e => setContract(e.target.value)}>{snapshot.holdings.map(h => <option key={h.contract} value={h.contract}>{h.symbol} · {shorten(h.contract)}</option>)}</select></label>
          <label>Hypothetical buy · USD<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></label></div>
        {!mandate.version && <p>Save your mandate to preview purchase checks.</p>}
        {mandate.version > 0 && !preview && <p>Enter a positive amount with at most two decimal places.</p>}
        {preview?.checks.map(check => <div className={`ws-receipt-check ws-partial-${check.state}`} key={check.label}><b>{check.state.toUpperCase()}</b><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}
        <p>No order is prepared, signed or sent. Automatic spending is unavailable.</p></div>}
      <details className="ws-chain-evidence"><summary>Inspect observation evidence</summary><p>ID: {snapshot.id}</p><p>Exact ETH balance: {snapshot.eth} ETH. The summary truncates to four decimal places.</p><p>Source: {snapshot.source} plus official Robinhood quote API</p>
        <p>Address: {snapshot.address} · Chain {snapshot.chainId}</p><p>Block <a href={`${CHAIN.explorer}/block/${BigInt(snapshot.block).toString()}`} target="_blank" rel="noreferrer">{BigInt(snapshot.block).toString()}</a>. Same-block balances; finality is not guaranteed.</p>
        <p>{snapshot.scanned} supported contracts scanned · {snapshot.failures} failed balance reads. Failures do not prove zero holdings.</p>
        <p>Quotes are excluded if more than two minutes old, halted, mismatched or missing a valid multiplier. Prices are indicative midpoints, not swap quotes. At most 20 held tokens are priced per scan.</p>
        <a href="https://docs.robinhood.com/chain/stock-token-apis/" target="_blank" rel="noreferrer">Official data documentation ↗</a></details>
      <p>Optional monitoring and ownership verification are in Autonomy. Live spending remains inactive.</p>
    </div>}
    {history.length > 0 && <div className="ws-chain-history"><span className="ws-label">YOUR SAVED OBSERVATIONS / LATEST 20</span>{history.map((record, i) => <div key={record.id}>
      <span>{shorten(record.address)} · {when(record.observedAt)} · {record.holdings.length} holdings</span><button className="ws-recheck" disabled={busy} onClick={() => {
        generation.current++; setAddress(record.address); setSnapshot(record); setPrevious(history.slice(i + 1).find(h => h.address === record.address) ?? null);
        setContract(record.holdings[0]?.contract ?? ""); setNotice("Inspecting saved evidence. Refresh before relying on its prices.");
      }}>Inspect</button></div>)}</div>}
  </section>;
}

