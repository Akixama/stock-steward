"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ArrowRight, ArrowUpRight, Check, ChevronRight, CircleDot, Clock3,
  ExternalLink, FileText, LockKeyhole, RotateCcw, ShieldCheck, SlidersHorizontal,
} from "lucide-react";
import { BrandMark, BrandName } from "@/components/brand";
import {flushSync} from 'react-dom';
import { RouteLink } from "@/components/route-transition";
import type { DecisionReceipt, Mandate, OrderEvent } from "@/lib/decision";
import type { ApprovalPlan } from "@/lib/approval-plan";
import type { Observation } from "@/lib/anytime";
import AccountPanel from "./account-panel";
import ChainPanel from "./chain-panel";
import AutonomyPanel from "./autonomy-panel";
import "./workspace.css";

type View = "overview" | "mandate" | "trail";
const initial: Mandate = {
  version: 0, allowedSymbols: [], maxOrderCents: 10_000,
  maxDailyBuyCents: 25_000, maxPositionBps: 1_500, requireApproval: true,
  executionPreference: "approval",
};
const oldDeviceStore = "stock-steward-brokerage-mandate-v1";
const usd = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(cents / 100);
const when = (value: string) => `${new Date(value).toISOString().replace("T", " ").slice(0, 16)} UTC`;
function receiptState(receipt: DecisionReceipt) {
  const last = receipt.orderEvents.at(-1)?.type;
  if (last === "declined") return { label: "DECLINED", tone: "held" };
  if (last === "filled") return { label: "FILLED", tone: "success" };
  if (last === "rejected") return { label: "REJECTED", tone: "held" };
  if (last === "canceled" || last === "expired") return { label: last.toUpperCase(), tone: "held" };
  if (last === "partially_filled") return { label: "PARTIAL FILL", tone: "success" };
  if (last === "submission_unknown") return { label: "STATUS UNKNOWN", tone: "held" };
  if (last === "submission_aborted") return { label: "NOT SENT", tone: "held" };
  if (last === "submission_started") return { label: "CHECKING BROKER", tone: "neutral" };
  if (last === "submitted") return { label: "SUBMITTED", tone: "neutral" };
  if (last === "authorized") return { label: "APPROVED / UNSENT", tone: "neutral" };
  return receipt.status === "held"
    ? { label: "HELD", tone: "held" }
    : { label: "CHECKS PASSED", tone: "neutral" };
}

export default function WorkspaceClient({ initialMandate, initialReceipts, initialObservations, connection, alpacaReady,
  orderSubmissionReady, storageError }: {
  initialMandate: Mandate | null;
  initialReceipts: DecisionReceipt[];
  initialObservations: Observation[];
  connection: { accountRef: string; environment: "live" | "paper"; tradingScope: boolean } | null;
  alpacaReady: boolean;
  orderSubmissionReady: boolean;
  storageError: string | null;
}) {
  const mainRef=useRef<HTMLElement|null>(null),navRef=useRef<HTMLElement|null>(null),motion=useRef<Animation|null>(null),navigation=useRef(0);
  const [indicator,setIndicator]=useState({left:5,width:0});
  const [view, setView] = useState<View>("overview");
  useEffect(()=>{const nav=navRef.current;if(!nav)return;const measure=()=>{const selected=nav.querySelector<HTMLButtonElement>('button.selected');if(selected)setIndicator({left:selected.offsetLeft,width:selected.offsetWidth});};measure();const observer=new ResizeObserver(measure);observer.observe(nav);return()=>observer.disconnect();},[view]);
  useEffect(()=>()=>{navigation.current++;motion.current?.cancel();},[]);
  const [animateView, setAnimateView] = useState(true);
  const [mandate, setMandate] = useState<Mandate>(initialMandate ?? initial);
  const [symbols, setSymbols] = useState(initialMandate?.allowedSymbols.join(", ") ?? "");
  const [maxOrder, setMaxOrder] = useState(String((initialMandate ?? initial).maxOrderCents / 100));
  const [maxDaily, setMaxDaily] = useState(String((initialMandate ?? initial).maxDailyBuyCents / 100));
  const [maxPosition, setMaxPosition] = useState(String((initialMandate ?? initial).maxPositionBps / 100));
  const [executionPreference, setExecutionPreference] = useState<"approval" | "automatic">(initialMandate?.executionPreference ?? "approval");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [legacyDraft, setLegacyDraft] = useState(false);
  const [receipts, setReceipts] = useState(initialReceipts);
  const [observations, setObservations] = useState(initialObservations);
  const [brokerConnection, setBrokerConnection] = useState(connection);
  const [brokerMessage, setBrokerMessage] = useState<string | null>(null);
  const [proposalSymbol, setProposalSymbol] = useState("");
  const [proposalAmount, setProposalAmount] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshingOrders, setRefreshingOrders] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [highlightedReceiptId, setHighlightedReceiptId] = useState<string | null>(null);
  const [approvalPlan, setApprovalPlan] = useState<ApprovalPlan | null>(null);
  const [approvalAcknowledged, setApprovalAcknowledged] = useState<string | null>(null);

  useEffect(() => {
    if (!approvalPlan) return;
    const remaining = Date.parse(approvalPlan.expiresAt) - Date.now();
    if (remaining <= 0) {
      const timer = window.setTimeout(() => setApprovalPlan(null), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setApprovalPlan(null), remaining);
    return () => window.clearTimeout(timer);
  }, [approvalPlan]);

  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("broker");
    if (status) {
      const messages: Record<string, string> = {
        connected: "Alpaca account connected. You can now check a proposed buy against a fresh account snapshot.",
        trading_connected: "Alpaca trading permission connected for this account. Every order still needs exact approval.",
        denied: "Alpaca connection was canceled. No account was connected.",
        invalid_state: "Alpaca connection expired or failed its security check. Please retry.",
        failed: "Alpaca connection failed. No account was connected.",
        unavailable: "Alpaca connection is not configured yet.",
      };
      const timer = window.setTimeout(() => setBrokerMessage(messages[status] ?? null), 0);
      window.history.replaceState(null, "", "/workspace");
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    if (initialMandate) return;
    try {
      const raw = localStorage.getItem(oldDeviceStore);
      if (!raw) return;
      const previous = JSON.parse(raw) as Partial<Mandate>;
      if (previous.requireApproval !== true || !Array.isArray(previous.allowedSymbols) ||
        !previous.allowedSymbols.every((value) => typeof value === "string") ||
        !Number.isSafeInteger(previous.maxOrderCents) || !Number.isSafeInteger(previous.maxDailyBuyCents) ||
        !Number.isSafeInteger(previous.maxPositionBps)) return;
      const timer = window.setTimeout(() => {
        setSymbols(previous.allowedSymbols!.join(", "));
        setMaxOrder(String(previous.maxOrderCents! / 100));
        setMaxDaily(String(previous.maxDailyBuyCents! / 100));
        setMaxPosition(String(previous.maxPositionBps! / 100));
        setLegacyDraft(true);
      }, 0);
      return () => window.clearTimeout(timer);
    } catch { /* An invalid old device preference does not replace server state. */ }
  }, [initialMandate]);

  const allowedSymbols = [...new Set(symbols.toUpperCase().split(/[\s,]+/).filter(Boolean))];
  const orderCents = Math.round(Number(maxOrder) * 100);
  const dailyCents = Math.round(Number(maxDaily) * 100);
  const positionBps = Math.round(Number(maxPosition) * 100);
  const valid = allowedSymbols.length <= 32 && allowedSymbols.every((symbol) => /^[A-Z.]{1,8}$/.test(symbol)) &&
    [maxOrder, maxDaily, maxPosition].every((value) => value.trim() !== "" && Number.isFinite(Number(value))) &&
    Number(maxOrder) >= 0.01 && Number(maxDaily) >= Number(maxOrder) && Number(maxDaily) <= 1_000_000 &&
    Number(maxPosition) > 0 && Number(maxPosition) <= 100;
  const dirty = mandate.version === 0 || allowedSymbols.join(",") !== mandate.allowedSymbols.join(",") ||
    orderCents !== mandate.maxOrderCents || dailyCents !== mandate.maxDailyBuyCents ||
    positionBps !== mandate.maxPositionBps || executionPreference !== (mandate.executionPreference ?? "approval");

  async function navigate(next: View, event?: MouseEvent<HTMLButtonElement>) {
    const ticket=++navigation.current;motion.current?.cancel();if(next===view)return;
    const enabled=(!event||event.detail!==0)&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setAnimateView(enabled);const panel=mainRef.current;
    const direction=['overview','mandate','trail'].indexOf(next)>['overview','mandate','trail'].indexOf(view)?1:-1;
    if(enabled&&panel){motion.current=panel.animate([{opacity:1,transform:'translateX(0)'},{opacity:0,transform:'translateX('+(-direction*8)+'px)'}],{duration:110,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'});try{await motion.current.finished;}catch{return;}}
    if(ticket!==navigation.current)return;motion.current?.cancel();flushSync(()=>setView(next));window.scrollTo(0,0);
    if(enabled&&panel)motion.current=panel.animate([{opacity:0,transform:'translateX('+(direction*12)+'px)'},{opacity:1,transform:'translateX(0)'}],{duration:240,easing:'cubic-bezier(.23,1,.32,1)'});
  }

  function resetDraft() {
    setSymbols(mandate.allowedSymbols.join(", "));
    setMaxOrder(String(mandate.maxOrderCents / 100));
    setMaxDaily(String(mandate.maxDailyBuyCents / 100));
    setMaxPosition(String(mandate.maxPositionBps / 100));
    setExecutionPreference(mandate.executionPreference ?? "approval");
    setSaveError(null);
    setSaved(false);
    if (legacyDraft) {
      localStorage.removeItem(oldDeviceStore);
      setLegacyDraft(false);
    }
  }

  async function saveMandate() {
    if (!valid || !dirty || saving || storageError) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/workspace/mandate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseVersion: mandate.version, allowedSymbols,
          maxOrderCents: orderCents, maxDailyBuyCents: dailyCents, maxPositionBps: positionBps, executionPreference,
        }),
      });
      const result = await response.json() as { mandate?: Mandate; error?: string };
      if (!response.ok || !result.mandate) throw new Error(result.error ?? "Could not save your mandate.");
      setMandate(result.mandate);
      if (legacyDraft) {
        localStorage.removeItem(oldDeviceStore);
        setLegacyDraft(false);
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2800);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save your mandate.");
    } finally {
      setSaving(false);
    }
  }

  async function checkProposal() {
    const amountCents = Math.round(Number(proposalAmount) * 100);
    const symbol = proposalSymbol.trim().toUpperCase();
    if (!brokerConnection || !mandate.version || checking ||
      !/^[A-Z.]{1,8}$/.test(symbol) || !Number.isSafeInteger(amountCents) || amountCents <= 0) return;
    setChecking(true);
    setCheckError(null);
    try {
      const response = await fetch("/api/workspace/check", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol, amountCents }) });
      const result = await response.json() as { receipt?: DecisionReceipt; observation?: Observation; approvalPlan?: ApprovalPlan | null; error?: string };
      if (response.ok && result.observation) {
        setObservations(current => [result.observation!, ...current].slice(0, 50));
        setApprovalPlan(null); setApprovalAcknowledged(null); setView("trail"); window.scrollTo(0, 0); return;
      }
      if (!response.ok || !result.receipt) throw new Error(result.error ?? "No decision was made.");
      setReceipts((current) => [result.receipt!, ...current].slice(0, 50));
      setHighlightedReceiptId(result.receipt.id);
      setApprovalPlan(result.approvalPlan ?? null);
      setApprovalAcknowledged(null);
      setView("trail");
      window.scrollTo(0, 0);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : "No decision was made.");
    } finally {
      setChecking(false);
    }
  }

  async function disconnectBroker() {
    setCheckError(null);
    const response = await fetch("/api/broker/alpaca/disconnect", { method: "POST" });
    if (response.ok) {
      setBrokerConnection(null);
      setApprovalPlan(null);
      setApprovalAcknowledged(null);
      setBrokerMessage("Alpaca account disconnected. Existing receipts remain in your trail.");
    } else {
      setBrokerMessage("Could not disconnect Alpaca. Please retry.");
    }
  }

  async function declineReceipt(receiptId: string) {
    if (actingOn) return;
    setActingOn(receiptId);
    setActionError(null);
    try {
      const response = await fetch(`/api/workspace/decisions/${encodeURIComponent(receiptId)}/decline`, {
        method: "POST",
      });
      const result = await response.json() as { receipt?: DecisionReceipt; error?: string };
      if (!response.ok || !result.receipt) throw new Error(result.error ?? "Could not decline this proposal.");
      setReceipts((current) => current.map((item) => item.id === receiptId ? result.receipt! : item));
      setApprovalPlan((current) => current?.receiptId === receiptId ? null : current);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not decline this proposal.");
    } finally {
      setActingOn(null);
    }
  }

  async function recheckReceipt(receipt: DecisionReceipt) {
    if (!brokerConnection || brokerConnection.accountRef !== receipt.evidence.accountRef || actingOn) return;
    setActingOn(receipt.id);
    setActionError(null);
    try {
      const response = await fetch("/api/workspace/check", { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receipt.proposal),
      });
      const result = await response.json() as { receipt?: DecisionReceipt; observation?: Observation; approvalPlan?: ApprovalPlan | null; error?: string };
      if (response.ok && result.observation) {
        setObservations(current => [result.observation!, ...current].slice(0, 50));
        setApprovalPlan(null); setApprovalAcknowledged(null); return;
      }
      if (!response.ok || !result.receipt) throw new Error(result.error ?? "Could not recheck this proposal.");
      setReceipts((current) => [result.receipt!, ...current].slice(0, 50));
      setHighlightedReceiptId(result.receipt.id);
      setApprovalPlan(result.approvalPlan ?? null);
      setApprovalAcknowledged(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not recheck this proposal.");
    } finally {
      setActingOn(null);
    }
  }

  async function approveReceipt(plan: ApprovalPlan) {
    if (!brokerConnection?.tradingScope || !orderSubmissionReady ||
      approvalAcknowledged !== plan.receiptId || dirty || actingOn) return;
    setActingOn(plan.receiptId);
    setActionError(null);
    try {
      const response = await fetch(`/api/workspace/decisions/${encodeURIComponent(plan.receiptId)}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId: plan.receiptId, accountRef: plan.accountRef,
          symbol: plan.order.symbol, notional: plan.order.notional }),
      });
      const result = await response.json() as { receipt?: DecisionReceipt; error?: string };
      if (!response.ok || !result.receipt) throw new Error(result.error ?? "Order approval failed.");
      setReceipts((current) => current.map((item) => item.id === plan.receiptId ? result.receipt! : item));
      setApprovalPlan(null);
      setApprovalAcknowledged(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Order approval failed.");
    } finally {
      setActingOn(null);
    }
  }

  async function reconcileReceipt(receiptId: string) {
    if (actingOn) return;
    setActingOn(receiptId);
    setActionError(null);
    try {
      const response = await fetch(`/api/workspace/decisions/${encodeURIComponent(receiptId)}/reconcile`, {
        method: "POST",
      });
      const result = await response.json() as { receipt?: DecisionReceipt;
        brokerStatus?: string; error?: string };
      if (!response.ok || !result.receipt) throw new Error(result.error ?? "Broker lookup failed.");
      setReceipts((current) => current.map((item) => item.id === receiptId ? result.receipt! : item));
      if (result.brokerStatus === "not_found") {
        setActionError("Alpaca has not returned this client order ID. Its outcome remains unknown; no new order was sent.");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Broker lookup failed.");
    } finally {
      setActingOn(null);
    }
  }

  async function refreshPendingOrders() {
    if (!brokerConnection || refreshingOrders || actingOn) return;
    setRefreshingOrders(true);
    setActionError(null);
    setRefreshMessage(null);
    try {
      const response = await fetch("/api/workspace/orders/refresh", { method: "POST" });
      const result = await response.json() as { checked?: number; receipts?: DecisionReceipt[];
        notFound?: string[]; failures?: { receiptId: string; error: string }[]; error?: string };
      if (!response.ok || !result.receipts) throw new Error(result.error ?? "Broker order refresh failed.");
      const updated = new Map(result.receipts.map((receipt) => [receipt.id, receipt]));
      setReceipts((current) => current.map((receipt) => updated.get(receipt.id) ?? receipt));
      const issues = (result.notFound?.length ?? 0) + (result.failures?.length ?? 0);
      setRefreshMessage(`${result.checked ?? 0} broker order${result.checked === 1 ? "" : "s"} checked; ${issues} unresolved. No order was submitted.`);
      if (result.failures?.length) {
        setActionError(`${result.failures.length} order lookup${result.failures.length === 1 ? "" : "s"} failed. Check the individual receipts or Alpaca dashboard.`);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Broker order refresh failed.");
    } finally {
      setRefreshingOrders(false);
    }
  }

  const pendingOrders = receipts.filter((receipt) =>
    brokerConnection?.accountRef === receipt.evidence.accountRef &&
    ["authorized", "submission_started", "submission_unknown", "submitted", "partially_filled"]
      .includes(receipt.orderEvents.at(-1)?.type ?? "")).length;

  return <div className="ws">
    <header className="ws-header">
      <RouteLink href="/" className="ws-brand" aria-label="Stock Steward home"><BrandMark /><BrandName /></RouteLink>
      <div className="ws-header-actions">
        <span className="ws-header-caption">PRIVATE WORKSPACE</span>
        <RouteLink href="/guide" className="ws-guide-link">Guide <ArrowUpRight size={15} /></RouteLink>
      </div>
    </header>

    <div className="ws-shell">
      <div className="ws-toolbar">
        <div className="ws-toolbar-title"><span className="ws-toolbar-orb" aria-hidden="true" /><span>Steward / Workspace</span></div>
        <nav ref={navRef} className="ws-nav" aria-label="Workspace views"><span className="ws-nav-indicator" aria-hidden="true" style={{opacity:indicator.width?1:0,width:indicator.width,transform:"translateX("+indicator.left+"px)"}}/>
          <button type="button" className={view === "overview" ? "selected" : ""} aria-current={view === "overview" ? "page" : undefined} onClick={(event) => navigate("overview", event)}><CircleDot size={16} />Overview</button>
          <button type="button" className={view === "mandate" ? "selected" : ""} aria-current={view === "mandate" ? "page" : undefined} onClick={(event) => navigate("mandate", event)}><SlidersHorizontal size={16} />Mandate<span>{mandate.version ? `v${mandate.version}` : "draft"}</span></button>
          <button type="button" className={view === "trail" ? "selected" : ""} aria-label="Decision trail" aria-current={view === "trail" ? "page" : undefined} onClick={(event) => navigate("trail", event)}><Clock3 size={16} />Trail<span>{receipts.length}</span></button>
        </nav>
        <span className="ws-offline"><i /> {brokerConnection ? `Alpaca ${brokerConnection.environment} linked` : "Broker offline"}</span>
      </div>

      <main ref={mainRef} className="ws-main">
        {storageError && <p className="ws-error" role="alert">{storageError}</p>}
        {brokerMessage && <p className="ws-import-note" role="status">{brokerMessage}</p>}
        {view === "overview" && <div className="ws-view" data-animate={animateView} key="overview">
          <div className="ws-page-head"><div><span className="ws-eyebrow">01 / THE CURRENT STATE</span><h1>Your money deserves<br /><em>an explanation.</em></h1><p>Your limits are yours to set. The connection and decision trail stay honest about what has actually happened.</p></div><span className="ws-page-index">STOCK STEWARD / 01</span></div>
          <ChainPanel mandate={mandate} />
          <AutonomyPanel mandate={mandate} />
          <div className="ws-overview-grid">
            <section className="ws-connection">
              <div className="ws-panel-top"><span className="ws-label">BROKER CONNECTION</span><span className="ws-panel-index">01 / 03</span></div>
              <div className="ws-connection-body"><span className="ws-status-line"><i /> {brokerConnection ? `ALPACA ${brokerConnection.environment.toUpperCase()} CONNECTED` : "NOT CONNECTED"}</span><h2>{brokerConnection ? <>Connected.<br />Still in control.</> : <>Nothing moves<br />without a record.</>}</h2><p>{brokerConnection ? brokerConnection.tradingScope && orderSubmissionReady ? "This account granted trading access. A fresh passing check and your exact approval are required for every order." : "Stock Steward can request a fresh, read-only broker snapshot. Order submission is not enabled for this connection." : "Alpaca Connect is the first planned broker path. No account is connected; Steward has not read positions, checked a quote, or submitted an order."}</p><div className="ws-connection-art" aria-hidden="true"><div className="ws-art-ring ws-art-ring-one" /><div className="ws-art-ring ws-art-ring-two" /><div className="ws-art-ring ws-art-ring-three" /><div className="ws-art-core"><LockKeyhole size={24} strokeWidth={1.35} /></div></div></div>
              <div className="ws-connection-bottom"><span>{brokerConnection ? `Account ···${brokerConnection.accountRef.slice(-6)}` : "Alpaca Connect · setup pending"}</span>{brokerConnection ? <button type="button" className="ws-connection-link" onClick={disconnectBroker}>Disconnect Alpaca</button> : alpacaReady ? <a href="/connect">Connect Alpaca <ExternalLink size={15} /></a> : <RouteLink href="/guide#roadmap">Connection plan <ExternalLink size={15} /></RouteLink>}</div>
              {brokerConnection && orderSubmissionReady && !brokerConnection.tradingScope && <a className="ws-trading-consent" href="/connect?intent=trading">Review Alpaca trading permission <ExternalLink size={15} /></a>}
            </section>
            <section className="ws-mandate-preview">
              <div className="ws-panel-top"><span className="ws-label">YOUR BOUNDARIES</span><span className="ws-panel-index">02 / 03</span></div>
              <div className="ws-preview-body"><span className="ws-preview-version">{mandate.version ? `MANDATE VERSION ${mandate.version}` : "NO MANDATE SAVED"}</span><h2>{mandate.version ? "Rules in place." : "Begin with a boundary."}</h2><p>{mandate.version ? `${mandate.allowedSymbols.length} approved stocks. Your limits are saved in this signed-in workspace.` : "Define what may be considered before a broker is ever connected."}</p><div className="ws-preview-rules"><div className="ws-preview-rule"><span>Single buy limit</span><strong>{mandate.version ? usd(mandate.maxOrderCents) : "—"}</strong></div><div className="ws-preview-rule"><span>Daily buy limit</span><strong>{mandate.version ? usd(mandate.maxDailyBuyCents) : "—"}</strong></div><div className="ws-preview-rule"><span>Position ceiling</span><strong>{mandate.version ? `${mandate.maxPositionBps / 100}%` : "—"}</strong></div></div></div>
              <button type="button" className="ws-text-action" onClick={() => navigate("mandate")}>{mandate.version ? "Review your mandate" : "Set your boundaries"}<ArrowUpRight size={17} /></button>
            </section>
          </div>
          {brokerConnection && <AccountPanel />}
          {brokerConnection && <section className="ws-check-panel"><div><span className="ws-label">READ-ONLY BROKER CHECK</span><h2>Consider a buy.</h2><p>Steward reads fresh account evidence and checks your limits. Outside regular hours, it saves a partial check with price-dependent items pending. No order is sent.</p></div><div className="ws-check-fields"><label>Stock symbol<input value={proposalSymbol} onChange={(event) => setProposalSymbol(event.target.value.toUpperCase())} placeholder="AAPL" maxLength={8} /></label><label>Proposed amount · USD<input value={proposalAmount} onChange={(event) => setProposalAmount(event.target.value)} type="number" min="0.01" step="0.01" placeholder="25.00" /></label><button type="button" onClick={checkProposal} disabled={!mandate.version || checking || !/^[A-Z.]{1,8}$/.test(proposalSymbol.trim()) || !Number.isFinite(Number(proposalAmount)) || Number(proposalAmount) <= 0}>{checking ? "Checking…" : "Check limits"}<ArrowRight size={16} /></button></div>{!mandate.version && <small>Save your mandate before checking a proposal.</small>}{checkError && <p className="ws-error" role="alert">{checkError}</p>}</section>}
          <button type="button" className="ws-overview-trail" onClick={() => navigate("trail")}><div className="ws-trail-monogram"><FileText size={19} /></div><div><span className="ws-label">DECISION TRAIL</span><strong>{receipts.length ? `${receipts.length} recorded decisions` : "A place for every reason."}</strong><p>{receipts.length ? "Inspect the evidence, checks, and outcome." : "No investment decisions have been recorded."}</p></div><span className="ws-overview-trail-end">{receipts.length} receipts <ChevronRight size={18} /></span></button>
        </div>}

        {view === "mandate" && <div className="ws-view" data-animate={animateView} key="mandate">
          <div className="ws-page-head"><div><span className="ws-eyebrow">02 / YOUR MANDATE</span><h1>Decide the limits.<br /><em>Keep the control.</em></h1><p>Make the rules specific. Saving them does not connect a broker or authorize a trade.</p></div><span className="ws-page-index">{mandate.version ? `POLICY VERSION ${mandate.version}` : "UNSAVED DRAFT"}</span></div>
          {legacyDraft && <p className="ws-import-note">Earlier device-only limits were found. Review these fields, then save to move them into your signed-in workspace.</p>}
          <div className="ws-mandate-grid">
            <section className="ws-editor">
              <div className="ws-editor-intro"><span className="ws-label">PURCHASE POLICY</span><h2>Make room for restraint.</h2><p>Choose how actions are handled. Saving this mandate never authorizes a trade.</p></div>
              <div className="ws-fields">
                <label className="ws-field ws-field-wide"><span>Approved stock symbols</span><input value={symbols} onChange={(event) => setSymbols(event.target.value)} placeholder="AAPL, MSFT, NVDA" aria-label="Approved stock symbols" /><small>Separate tickers with commas. Leave empty to approve no purchases.</small></label>
                <label className="ws-field"><span>Maximum single buy</span><div className="ws-input-unit"><b>$</b><input type="number" min="0.01" step="0.01" value={maxOrder} onChange={(event) => setMaxOrder(event.target.value)} /></div></label>
                <label className="ws-field"><span>Maximum buys per day</span><div className="ws-input-unit"><b>$</b><input type="number" min="0.01" step="0.01" value={maxDaily} onChange={(event) => setMaxDaily(event.target.value)} /></div></label>
                <label className="ws-field ws-field-wide"><span>Maximum one-stock exposure</span><div className="ws-input-unit"><input type="number" min="0.01" max="100" step="0.01" value={maxPosition} onChange={(event) => setMaxPosition(event.target.value)} /><b>%</b></div></label>
                <fieldset className="ws-execution-field"><legend>Action preference</legend><div className="ws-execution-options"><label className={executionPreference === "approval" ? "selected" : ""}><input type="radio" name="execution-preference" value="approval" checked={executionPreference === "approval"} onChange={() => setExecutionPreference("approval")} /><span><strong>Ask me every time</strong><small>Review and approve each exact order before submission.</small></span></label><label className={executionPreference === "automatic" ? "selected" : ""}><input type="radio" name="execution-preference" value="automatic" checked={executionPreference === "automatic"} onChange={() => setExecutionPreference("automatic")} /><span><strong>Automatic within limits</strong><small>Save this for a future release. It is inactive today.</small></span></label></div><p>Automatic action would need a supported broker, separate activation, and tested safety controls. Selecting it here never grants trading authority.</p></fieldset>
              </div>
              <div className="ws-editor-footer"><div><span className={dirty ? "ws-dirty-dot" : "ws-clean-dot"} />{dirty ? "Unsaved changes" : `Saved as version ${mandate.version}`}</div><div className="ws-editor-actions">{dirty && mandate.version > 0 && <button type="button" className="ws-reset" onClick={resetDraft}><RotateCcw size={15} />Reset draft</button>}<button type="button" className={saved && !dirty ? "ws-save is-saved" : "ws-save"} onClick={saveMandate} disabled={!valid || !dirty || saving || Boolean(storageError)}>{saving ? "Saving…" : saved && !dirty ? <><Check size={17} /> Saved</> : <>Save mandate <ArrowRight size={17} /></>}</button></div></div>
            </section>
            <aside className="ws-policy-preview"><div className="ws-policy-preview-head"><ShieldCheck size={18} /><span>LIVE PREVIEW / DRAFT</span></div><h2>What your limits say.</h2><p className="ws-policy-sentence">{allowedSymbols.length ? <>Consider <strong>{allowedSymbols.slice(0, 3).join(", ")}{allowedSymbols.length > 3 ? ` +${allowedSymbols.length - 3}` : ""}</strong> only.</> : <>Consider <strong>no stock purchases</strong>.</>} A single buy stays under <strong>{Number.isFinite(orderCents) ? usd(orderCents) : "—"}</strong>, with no more than <strong>{Number.isFinite(dailyCents) ? usd(dailyCents) : "—"}</strong> bought in a day.</p><div className="ws-preview-meter"><div><span>One-stock ceiling</span><strong>{Number.isFinite(positionBps) ? `${(positionBps / 100).toFixed(2)}%` : "—"}</strong></div><div className="ws-meter-track"><span style={{ transform: `scaleX(${valid ? Math.min(100, Number(maxPosition)) / 100 : 0})` }} /></div><small>Share of total account value</small></div><div className="ws-approval"><span><Check size={16} /></span><div><strong>{executionPreference === "approval" ? "Approval before each order" : dirty ? "Automatic preference in draft" : "Automatic preference saved"}</strong><p>{executionPreference === "approval" ? "Current execution rule. Broker access and a fresh check are also required." : "Inactive. Approval remains required in this version."}</p></div></div><p className="ws-preview-disclaimer"><LockKeyhole size={14} /> Preview of your rules, not a market decision.</p></aside>
          </div>
          {saveError && <p className="ws-error" role="alert">{saveError}</p>}
          <div className="ws-below-note"><LockKeyhole size={16} /> A saved mandate does not connect a broker or place an order.</div>
        </div>}

        {view === "trail" && <div className="ws-view" data-animate={animateView} key="trail">
          <div className="ws-page-head"><div><span className="ws-eyebrow">03 / DECISION TRAIL</span><h1>See the reason.<br /><em>See the result.</em></h1><p>Every hold or proposal belongs with its evidence, limits, and any later broker-confirmed outcome.</p></div><span className="ws-page-index">{receipts.length} RECEIPTS</span></div>
          {actionError && <p className="ws-error" role="alert">{actionError}</p>}
          {refreshMessage && <p className="ws-refresh-note" role="status">{refreshMessage}</p>}
          {observations.length > 0 && <section className="ws-trail ws-observations"><div className="ws-trail-top"><span className="ws-label">PARTIAL CHECKS / NO TRADING APPROVAL</span><span>{observations.length} OBSERVATIONS</span></div><div className="ws-receipts">{observations.map((record, index) => <details className="ws-receipt" key={record.id} open={index === 0}><summary><span className="ws-receipt-status">PARTIAL</span><strong>{record.proposal.symbol} · {usd(record.proposal.amountCents)}</strong><time dateTime={record.createdAt}>{when(record.createdAt)}</time><ChevronRight size={17} /></summary><div className="ws-receipt-detail"><p>{record.why}</p><p>Mandate v{record.policyVersion} · {record.account.environment.toUpperCase()} Alpaca response retrieved {when(record.account.observedAt)}.</p><p>Cash {usd(record.account.cashCents)} · Funds without margin {usd(record.account.availableCashCents)}. Broker valuations may reflect the last session; no execution quote was used.</p>{record.checks.map(check => <div className={"ws-receipt-check ws-partial-" + check.state} key={check.rule}><b>{check.state.toUpperCase()}</b><span><strong>{check.rule}</strong><small>{check.detail}</small></span></div>)}<p>Next regular session: {when(record.retryAt)} (device time). Recheck then; no automatic retry is scheduled.</p><button type="button" className="ws-recheck" onClick={() => { setProposalSymbol(record.proposal.symbol); setProposalAmount((record.proposal.amountCents / 100).toFixed(2)); navigate("overview"); }}>Review this proposal <ArrowUpRight size={15} /></button></div></details>)}</div></section>}
          <section className="ws-trail"><div className="ws-trail-top"><span className="ws-label">OWNER-BOUND LEDGER</span><div className="ws-trail-actions"><span>{receipts.length} ENTRIES</span>{pendingOrders > 0 && <button type="button" onClick={refreshPendingOrders} disabled={refreshingOrders || Boolean(actingOn)}><RotateCcw size={14} />{refreshingOrders ? "Checking Alpaca…" : `Refresh ${pendingOrders} pending`}</button>}</div></div>
            {receipts.length ? <div className="ws-receipts">{receipts.map((receipt) => {
              const state = receiptState(receipt);
              return <details className="ws-receipt" key={receipt.id} open={receipt.id === highlightedReceiptId}>
                <summary><span className={`ws-receipt-status ${state.tone}`}>{state.label}</span><strong>{receipt.proposal.symbol} · {usd(receipt.proposal.amountCents)}</strong><time dateTime={receipt.createdAt}>{when(receipt.createdAt)}</time><ChevronRight size={17} /></summary>
                <div className="ws-receipt-detail"><p>{receipt.why}</p><p>Mandate v{receipt.policyVersion} · {receipt.evidence.source} · Broker observed {when(receipt.evidence.observedAt)}</p><p>Quote {usd(receipt.evidence.quoteCents)} · Portfolio {usd(receipt.evidence.portfolioValueCents)} · Cash available {usd(receipt.evidence.buyingPowerCents)}</p><div>{receipt.checks.map((check) => <div className="ws-receipt-check" key={check.rule}><b>{check.passed ? "PASS" : "HOLD"}</b><span>{check.explanation}<small>Observed {check.observed} · Limit {check.limit}</small></span></div>)}</div>{receipt.changeNeeded.length > 0 && <p>To reconsider: {receipt.changeNeeded.join(" ")}</p>}{receipt.status === "awaiting_approval" && receipt.orderEvents.length === 0 && <div className="ws-order-review"><div><span>EXACT PROPOSAL</span><strong>Buy {usd(receipt.proposal.amountCents)} of {receipt.proposal.symbol}</strong><small>Alpaca account ···{receipt.evidence.accountRef.slice(-6)} · Day order planned. Approval requires a fresh check and exact order review.</small></div><button type="button" onClick={() => declineReceipt(receipt.id)} disabled={Boolean(actingOn)}>{actingOn === receipt.id ? "Declining…" : "Decline proposal"}</button></div>}<p>{receipt.orderEvents.length ? `Owner and order events: ${receipt.orderEvents.map((event) => event.type).join(" → ")}` : "No order submitted for this receipt."}</p>{brokerConnection?.accountRef === receipt.evidence.accountRef && <button type="button" className="ws-recheck" onClick={() => recheckReceipt(receipt)} disabled={Boolean(actingOn)}><RotateCcw size={15} />{actingOn === receipt.id ? "Reading fresh data…" : "Recheck with fresh broker data"}</button>}</div>
                <p className="ws-quote-time">Quote timestamp: {Number.isFinite(Date.parse(receipt.evidence.quoteObservedAt ?? "")) ? when(receipt.evidence.quoteObservedAt) : "not captured in this earlier receipt"}</p>
                {receipt.orderEvents.length > 0 && <div className="ws-order-events"><span>ORDER EVENT TRAIL</span>{receipt.orderEvents.map((event, index) => <div key={index}><b>{event.type.replaceAll("_", " ")}</b><small>{when(event.at)}{orderEventDetail(event)}</small>{event.type === "submission_started" && event.recheckedChecks && <div className="ws-order-recheck"><span>FRESH BROKER CHECK</span>{event.recheckedChecks.map((check) => <p key={check.rule}><strong>{check.rule.replaceAll("_", " ")}</strong><span>{check.observed} · Limit {check.limit}</span></p>)}</div>}</div>)}</div>}
                {approvalPlan?.receiptId === receipt.id && receipt.orderEvents.length === 0 && <div className="ws-order-plan"><span>{brokerConnection?.tradingScope && orderSubmissionReady ? brokerConnection.environment === "paper" ? "PAPER ORDER REVIEW" : "LIVE ORDER REVIEW" : "ORDER SHAPE / READ ONLY"}</span><strong>{approvalPlan.order.type.toUpperCase()} BUY · ${approvalPlan.order.notional} · {approvalPlan.order.symbol}</strong><p>Day order for Alpaca account ···{approvalPlan.accountRef.slice(-6)}. Quoted ask {usd(approvalPlan.quotedAskCents)}. Review expires {when(approvalPlan.expiresAt)}. Market execution price can differ from this quote.</p>{brokerConnection?.tradingScope && orderSubmissionReady ? <div className="ws-order-confirm"><label><input type="checkbox" checked={approvalAcknowledged === receipt.id} onChange={(event) => setApprovalAcknowledged(event.target.checked ? receipt.id : null)} />I approve this exact {approvalPlan.order.notional} USD buy of {approvalPlan.order.symbol} for account ···{approvalPlan.accountRef.slice(-6)}.</label><button type="button" onClick={() => approveReceipt(approvalPlan)} disabled={Boolean(actingOn) || dirty || approvalAcknowledged !== receipt.id}>{actingOn === receipt.id ? "Submitting…" : brokerConnection.environment === "paper" ? "Approve PAPER order" : "Approve LIVE order"}</button>{dirty && <small>Save or reset your mandate draft, then run a new check before approving.</small>}</div> : <p>Inspection only. Trading permission and submission must be enabled separately; no order can be sent here.</p>}</div>}
                {brokerConnection?.accountRef === receipt.evidence.accountRef && receipt.orderEvents.some((event) => event.type === "submission_started") && <button type="button" className="ws-recheck ws-reconcile" onClick={() => reconcileReceipt(receipt.id)} disabled={Boolean(actingOn)}><RotateCcw size={15} />{actingOn === receipt.id ? "Checking Alpaca…" : "Refresh broker order status"}</button>}
              </details>;
            })}</div> : <div className="ws-trail-empty"><div className="ws-empty-visual" aria-hidden="true"><span className="ws-empty-sheet"><FileText size={23} /><i /><i /><i /></span><span className="ws-empty-orbit" /></div><div className="ws-trail-empty-copy"><span className="ws-preview-version">AWAITING FIRST BROKER OBSERVATION</span><h2>The trail begins<br />with real evidence.</h2><p>No complete market decision has been recorded. Partial checks appear separately above when available. A full check needs fresh broker evidence and a current quote during the regular session.</p><RouteLink href="/guide">Explore receipt anatomy <ArrowUpRight size={16} /></RouteLink></div></div>}
            <div className="ws-trail-foot"><span>01 / Evidence</span><span>02 / Rule checks</span><span>03 / Approval</span><span>04 / Outcome</span></div>
          </section>
        </div>}
      </main>
    </div>
  </div>;
}

function orderEventDetail(event: OrderEvent): string {
  if (event.type === "submission_started") {
    const snapshot = event.recheckedEvidence;
    return snapshot ? ` · Client ID ${event.clientOrderId} · Rechecked quote ${usd(snapshot.quoteCents)} · Cash ${usd(snapshot.buyingPowerCents)}`
      : ` · Client ID ${event.clientOrderId}`;
  }
  if ("reason" in event) return ` · ${event.reason}`;
  if ("filledCents" in event) return ` · Approx. cumulative fill ${usd(event.filledCents)}`;
  if ("clientOrderId" in event) return ` · Client ID ${event.clientOrderId}`;
  if ("brokerOrderId" in event) return ` · Broker ID ${event.brokerOrderId}`;
  return "";
}
