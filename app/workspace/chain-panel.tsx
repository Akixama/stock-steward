"use client";
import { useEffect, useRef, useState } from "react";
import WalletConnect from './wallet-connect';
import { useWalletSession, shareWalletSession } from './wallet-session';
import BridgeDialog from './bridge-dialog';
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
    <div className="ws-account-head"><div><span className="ws-label">WALLET & FUNDS</span><h2>Your wallet.</h2>
      <p>Look at your balances and bring funds over. Watching never signs anything.</p></div>
      {connected?<button className="ws-recheck" onClick={()=>{clear();shareWalletSession(null);setNotice("Disconnected. Saved receipts remain; you can still watch any address.");}} disabled={busy}>Disconnect from Steward</button>:<WalletConnect disabled={busy} onConnected={(p,address)=>{clear();setAddress(address);setNotice("Wallet connected. Observe & save reads its holdings at one block.");}}/>}</div>
    <div className="ws-check-fields"><label>Public address · ownership unverified<input value={address} disabled={busy} onChange={e => {
      generation.current++; setAddress(e.target.value.trim()); setSnapshot(null); setPrevious(null); setNotice(null);
    }} placeholder="0x…" spellCheck={false} /></label>
      <button onClick={read} disabled={busy || !valid(address)}>{busy ? "Reading evidence…" : "Observe & save"}</button></div>
    <div className="ws-chain-tools"><button className="ws-recheck" onClick={historyClick} disabled={busy}>Load saved observations</button>
      <span>Robinhood mainnet 4663 · reads limited to once per 15 seconds</span></div>
    <details className="ws-chain-note"><summary>About watching and saved records</summary><p>Watch-only addresses are supported. Saved records belong to your site login, not proof of wallet ownership. Disconnecting clears the current view; saved records remain.</p></details>
    <details className="ws-chain-fund">
      <summary>Get funds onto Robinhood Chain</summary>
      <p>Bring USDG (the chain's dollar) and a little ETH for network fees. The bridge settles straight to your wallet — Stock Steward never holds your funds.</p>
      <BridgeDialog provider={session?.provider ?? null} address={valid(address) ? address : sessionAddress} />
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
      <div className="ws-account-numbers ws-account-numbers-four">
        <div><span>ETH · gas</span><strong title={snapshot.eth+' ETH'}>{snapshot.eth.split('.')[0]}{snapshot.eth.includes('.')?'.'+snapshot.eth.split('.')[1].slice(0,4):''}</strong><small>Network fees. Exact balance in evidence.</small></div>
        <div><span>USDG · buying power</span><strong title={(snapshot.usdg ?? 'unknown')+' USDG'}>{snapshot.usdg == null ? '—' : snapshot.usdg.includes('.') ? snapshot.usdg.split('.')[0] + '.' + snapshot.usdg.split('.')[1].slice(0, 2).padEnd(2, '0') : snapshot.usdg}</strong><small>{snapshot.usdg == null ? 'Balance unreadable at this block.' : 'The chain’s dollar. Exact balance in evidence.'}</small></div>
        <div><span>Stock holdings</span><strong>{snapshot.holdings.length}</strong><small>{snapshot.pricedCount} of {snapshot.holdings.length} have indicative prices.</small></div>
        <div><span>{historical ? "Historical stock value" : "Stock value"}</span><strong>{usdMicro(snapshot.subtotalMicroUsd)}</strong><small>Supported stocks only.</small></div></div>
      <div className="ws-chain-brief"><strong>What needs attention</strong><ul className="ws-alert-list">{snapshot.alerts.map((alert, i) => <li key={i}>{alert}</li>)}</ul></div>
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
      }) : <div className="ws-empty-holdings"><strong>No stock tokens here yet.</strong><p>{snapshot.failures ? "Some reads failed, so this is not proof of zero holdings — but no positive balance was confirmed." : "This wallet holds no supported stock tokens at the observed block. Fund it and buy your first one to see it here."}</p></div>}</div>
      {snapshot.holdings.length > 0 && <div className="ws-chain-preview"><span className="ws-label">WHAT IF / HYPOTHETICAL PURCHASE</span><h3>Check before you act.</h3>
        <p>Would this purchase fit your saved rules? Choose a holding and enter an amount to preview the checks. Uses saved mandate v{mandate.version || "—"}; save any changes in Mandate first.</p><p>A failed check blocks the proposal. Pending means more evidence is needed. Passing individual checks does not authorize a trade.</p>
        <div className="ws-check-fields"><label>Observed stock token<select value={contract} onChange={e => setContract(e.target.value)}>{snapshot.holdings.map(h => <option key={h.contract} value={h.contract}>{h.symbol} · {shorten(h.contract)}</option>)}</select></label>
          <label>Hypothetical buy · USD<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" /></label></div>
        {!mandate.version && <p>Save your mandate to preview purchase checks.</p>}
        {mandate.version > 0 && !preview && <p>Enter a positive amount with at most two decimal places.</p>}
        {preview?.checks.map(check => <div className={`ws-receipt-check ws-partial-${check.state}`} key={check.label}><b>{check.state.toUpperCase()}</b><span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}
        <p>No order is prepared, signed or sent. Automatic spending is unavailable.</p></div>}
      <details className="ws-chain-evidence"><summary>Inspect observation evidence</summary>
        <dl className="ws-evidence-table">
          <div><dt>Record</dt><dd>{snapshot.id}</dd></div>
          <div><dt>ETH</dt><dd>{snapshot.eth} ETH</dd></div>
          <div><dt>USDG</dt><dd>{snapshot.usdg == null ? 'Unreadable at this block' : `${snapshot.usdg} USDG`}</dd></div>
          <div><dt>Wallet</dt><dd>{snapshot.address} · Chain {snapshot.chainId}</dd></div>
          <div><dt>Block</dt><dd><a href={`${CHAIN.explorer}/block/${BigInt(snapshot.block).toString()}`} target="_blank" rel="noreferrer">{BigInt(snapshot.block).toString()}</a> · same-block balances; finality is not guaranteed</dd></div>
          <div><dt>Coverage</dt><dd>{snapshot.scanned} contracts scanned · {snapshot.failures} failed reads (failures do not prove zero holdings)</dd></div>
          <div><dt>Prices</dt><dd>Indicative midpoints, not swap quotes · quotes older than two minutes, halted, mismatched or multiplier-less are excluded · at most 20 held tokens priced per scan</dd></div>
          <div><dt>Source</dt><dd>{snapshot.source} plus official Robinhood quote API · <a href="https://docs.robinhood.com/chain/stock-token-apis/" target="_blank" rel="noreferrer">Official data documentation ↗</a></dd></div>
        </dl></details>
      <p>Optional monitoring and ownership verification are in Autonomy. Live spending remains inactive.</p>
    </div>}
    {history.length > 0 && <div className="ws-chain-history"><span className="ws-label">YOUR SAVED OBSERVATIONS / LATEST 20</span>{history.map((record, i) => <div key={record.id}>
      <span>{shorten(record.address)} · {when(record.observedAt)} · {record.holdings.length} holdings</span><button className="ws-recheck" disabled={busy} onClick={() => {
        generation.current++; setAddress(record.address); setSnapshot(record); setPrevious(history.slice(i + 1).find(h => h.address === record.address) ?? null);
        setContract(record.holdings[0]?.contract ?? ""); setNotice("Inspecting saved evidence. Refresh before relying on its prices.");
      }}>Inspect</button></div>)}</div>}
  </section>;
}

