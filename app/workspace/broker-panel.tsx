"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { RouteLink } from "@/components/route-transition";
import type { AccountView, Observation } from "@/lib/anytime";
import type { DecisionReceipt, Mandate, OrderEvent } from "@/lib/decision";
import type { ApprovalPlan } from "@/lib/approval-plan";
import type { AgentPlan } from "@/lib/agent-decision";

export type BrokerStatus = {
  environment: "paper" | "live";
  connectedAt: string;
  tradingScope: boolean;
  orderSubmissionEnabled: boolean;
} | null;

const dollars = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(cents / 100);

type BrokerRecord = Observation | DecisionReceipt;

function eventHeadline(event: OrderEvent): string {
  switch (event.type) {
    case "filled": return `Order filled · ${dollars(event.filledCents)}`;
    case "partially_filled": return `Partially filled · ${dollars(event.filledCents)}`;
    case "submitted": return "Order submitted to the broker";
    case "submission_unknown": return "Submission outcome unknown · never retried";
    case "submission_aborted": return "Order aborted before submission";
    case "rejected": return "Broker rejected the order";
    case "canceled": return "Order canceled";
    case "expired": return "Order expired";
    case "authorized": return "Approved · submission in progress";
    case "declined": return "Declined · no order sent";
    default: return "Limits passed · no order sent";
  }
}

function RecordDetails({ record }: { record: BrokerRecord }) {
  const partial = record.kind === "observation";
  const lastEvent = record.kind === "decision" ? record.orderEvents.at(-1) : undefined;
  const headline = partial ? "Market closed · partial check"
    : record.status === "held" ? "Held by your limits"
    : lastEvent ? eventHeadline(lastEvent) : "Limits passed · no order sent";
  const submitted = !!lastEvent && ["submitted", "partially_filled", "filled", "canceled", "expired", "rejected"].includes(lastEvent.type);
  const rows = record.kind === "observation"
    ? record.checks.map(check => ({ rule: check.rule, state: check.state, detail: check.detail }))
    : record.checks.map(check => ({ rule: check.rule, state: check.passed ? "pass" : "fail",
      detail: `${check.explanation} Observed ${check.observed}; limit ${check.limit}.` }));
  return <div className="ws-broker-record">
    <div className="ws-broker-record-head"><strong>{headline}</strong>
      <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time></div>
    {record.kind === "decision" && record.proposedBy === "steward_agent" &&
      <p className="ws-agent-provenance">Steward made this decision automatically from your saved plan.</p>}
    <p>{record.proposal.symbol} · {dollars(record.proposal.amountCents)} proposed buy · mandate v{record.policyVersion}</p>
    <p>{record.why}</p>
    {partial && <p>Market-dependent checks can be retried after {new Date(record.retryAt).toLocaleString()}. This is not permission to trade.</p>}
    <div className="ws-broker-record-checks">{rows.map(check =>
      <div className={`ws-receipt-check ws-partial-${check.state}`} key={check.rule}>
        <b>{check.state.toUpperCase()}</b><span><strong>{check.rule.replaceAll("_", " ")}</strong>
          <small>{check.detail}</small></span>
      </div>)}</div>
    <small>Record ID {record.id}. {submitted ? "One order attempt only; it is never retried." : "This check reads broker data and never submits an order."}</small>
  </div>;
}

export default function BrokerPanel({ status, mandate, onOpenMandate }: {
  status: BrokerStatus; mandate: Mandate; onOpenMandate: () => void;
}) {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkBusy, setCheckBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [record, setRecord] = useState<BrokerRecord | null>(null);
  const [history, setHistory] = useState<BrokerRecord[] | null>(null);
  const [symbol, setSymbol] = useState(mandate.allowedSymbols[0] ?? "AAPL");
  const [amount, setAmount] = useState("1");
  const [disconnecting, setDisconnecting] = useState(false);
  const [plan, setPlan] = useState<ApprovalPlan | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentSymbol, setAgentSymbol] = useState(mandate.allowedSymbols[0] ?? "AAPL");
  const [agentAmount, setAgentAmount] = useState("1");
  const [agentSubmit, setAgentSubmit] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/workspace/agent", { cache: "no-store" })
      .then(response => response.json() as Promise<{ plan?: AgentPlan | null }>)
      .then(payload => {
        if (cancelled || !payload.plan) return;
        setAgentPlan(payload.plan);
        setAgentSymbol(payload.plan.symbol);
        setAgentAmount((payload.plan.amountCents / 100).toFixed(2));
        setAgentSubmit(payload.plan.submitOnPaper);
      })
      .catch(() => { /* The form still works without a saved plan. */ });
    return () => { cancelled = true; };
  }, []);

  async function saveAgent(enabled: boolean) {
    if (agentBusy) return;
    setAgentBusy(true);
    setAgentError(null);
    try {
      const body = enabled
        ? { enabled: true, symbol: agentSymbol.trim().toUpperCase(),
            amountCents: (() => {
              const [whole, fraction = ""] = agentAmount.trim().split(".");
              return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
            })(), submitOnPaper: agentSubmit }
        : { enabled: false };
      const response = await fetch("/api/workspace/agent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { plan?: AgentPlan; error?: string };
      if (!response.ok || !payload.plan) throw new Error(payload.error || "Automatic decisions were not saved.");
      setAgentPlan(payload.plan);
    } catch (cause) {
      setAgentError(cause instanceof Error ? cause.message : "Automatic decisions were not saved.");
    } finally {
      setAgentBusy(false);
    }
  }

  async function disconnect() {
    if (busy || !status || disconnecting) return;
    if (!window.confirm("Disconnect this broker connection? Saved checks stay in your history, but account refresh and proposal checks need a new connection.")) return;
    setDisconnecting(true);
    setError(null);
    try {
      const response = await fetch("/api/broker/alpaca/disconnect", {
        method: "POST", cache: "no-store",
        headers: { "X-Requested-With": "fetch" },
      });
      const payload = await response.json() as { disconnected?: boolean; error?: string };
      if (!response.ok || !payload.disconnected) throw new Error(payload.error || "Disconnect failed. Your connection was not changed.");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Disconnect failed. Your connection was not changed.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function refresh() {
    if (busy || !status) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/account", { cache: "no-store" });
      const payload = await response.json() as { account?: AccountView; error?: string };
      if (!response.ok || !payload.account) throw new Error(payload.error || "Account data is unavailable.");
      setAccount(payload.account);
    } catch (cause) {
      setAccount(null);
      setError(cause instanceof Error ? cause.message : "Account data is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  async function approveOrder() {
    if (!plan || approveBusy) return;
    const summary = `${plan.order.notional} USD · ${plan.order.symbol} · ${status?.environment ?? "paper"} account`;
    if (!window.confirm(`Approve and submit this exact order?\n\n${summary}\n\nThis places one market order on your connected ${status?.environment ?? "paper"} account. ${status?.environment === "paper" ? "No real money moves." : "This is a real order with real money."}`)) return;
    setApproveBusy(true);
    setCheckError(null);
    try {
      const response = await fetch(`/api/workspace/decisions/${plan.receiptId}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptId: plan.receiptId, accountRef: plan.accountRef, symbol: plan.order.symbol, notional: plan.order.notional }),
      });
      const payload = await response.json() as { receipt?: DecisionReceipt; error?: string };
      if (!response.ok || !payload.receipt) throw new Error(payload.error || "Order submission failed. Nothing else will be attempted.");
      setRecord(payload.receipt);
      setPlan(null);
      setHistory(current => current ? [payload.receipt!, ...current.filter(item => item.id !== payload.receipt!.id)].slice(0, 10) : null);
    } catch (cause) {
      setCheckError(cause instanceof Error ? cause.message : "Order submission failed. Nothing else will be attempted.");
    } finally {
      setApproveBusy(false);
    }
  }

  async function checkProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkBusy || !status || mandate.version < 1) return;
    setCheckError(null);
    setPlan(null);
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (!/^[A-Z.]{1,8}$/.test(normalizedSymbol) || !/^\d+(?:\.\d{1,2})?$/.test(amount.trim())) {
      setCheckError("Enter a stock symbol and an amount with up to two decimal places.");
      return;
    }
    const [whole, fraction = ""] = amount.trim().split(".");
    const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      setCheckError("Enter a positive amount in USD.");
      return;
    }
    setCheckBusy(true);
    try {
      const response = await fetch("/api/workspace/check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: normalizedSymbol, amountCents }),
      });
      const payload = await response.json() as { observation?: Observation; receipt?: DecisionReceipt; approvalPlan?: ApprovalPlan | null; error?: string };
      if (!response.ok || (!payload.observation && !payload.receipt)) {
        throw new Error(payload.error || "No check was recorded.");
      }
      const saved = (payload.observation ?? payload.receipt)!;
      setRecord(saved);
      setPlan(payload.approvalPlan ?? null);
      setHistory(current => current ? [saved, ...current.filter(item => item.id !== saved.id)].slice(0, 10) : null);
    } catch (cause) {
      setCheckError(cause instanceof Error ? cause.message : "No check was recorded.");
    } finally {
      setCheckBusy(false);
    }
  }

  async function loadHistory() {
    if (historyBusy || !status) return;
    setHistoryBusy(true);
    setCheckError(null);
    try {
      const response = await fetch("/api/workspace/check", { cache: "no-store" });
      const payload = await response.json() as { records?: BrokerRecord[]; error?: string };
      if (!response.ok || !payload.records) throw new Error(payload.error || "Saved checks are unavailable.");
      setHistory(payload.records);
    } catch (cause) {
      setCheckError(cause instanceof Error ? cause.message : "Saved checks are unavailable.");
    } finally {
      setHistoryBusy(false);
    }
  }

  return <section id="ws-broker-panel" className="ws-broker-panel" aria-labelledby="ws-broker-title">
    <div className="ws-broker-panel-head"><div><span className="ws-label">BROKER CONNECTION</span>
      <h2 id="ws-broker-title">{status ? `${status.environment === "paper" ? "Paper" : "Live"} account connected.` : "Connect an account to inspect it."}</h2>
      <p>{status ? "Alpaca account data can be checked here. This panel only reads and never submits an order." : "Practice works without a broker. Connect Alpaca separately when you want to test account reads."}</p>
    </div><span className="ws-broker-state">{status ? `${status.environment.toUpperCase()} · ${status.tradingScope ? "TRADING GRANT" : "DATA ACCESS"}` : "DISCONNECTED"}</span></div>
    {status && <div className="ws-broker-panel-body">
      {account ? <><div className="ws-broker-figures"><div><span>Account status</span><strong>{account.accountStatus}</strong></div><div><span>Equity</span><strong>{dollars(account.equityCents)}</strong></div><div><span>Available cash</span><strong>{dollars(account.availableCashCents)}</strong></div><div><span>Market</span><strong>{account.marketOpen ? "Open" : "Closed"}</strong></div></div>
        <p className="ws-broker-meta">{account.positions.length} positions · {account.orders.length} open orders · observed {new Date(account.observedAt).toLocaleString()}. No order was sent.</p></> : <p className="ws-broker-meta">Connected {new Date(status.connectedAt).toLocaleString()}. Run a read-only check to verify the account, positions, open orders and market clock.</p>}
      {error && <p className="ws-error" role="alert">{error}</p>}
    </div>}
    <div className="ws-broker-panel-actions">{status && <button type="button" onClick={refresh} disabled={busy}><RefreshCw size={16}/>{busy ? "Reading account…" : account ? "Refresh account" : "Read account now"}</button>}
        {status && <button type="button" className="ws-broker-disconnect" onClick={disconnect} disabled={busy || disconnecting}>{disconnecting ? "Disconnecting…" : "Disconnect"}</button>}
      <RouteLink href="/connect">{status ? "Review permission" : "Connect Alpaca"}<ArrowRight size={16}/></RouteLink></div>
    {status && <div className="ws-broker-decision">
      <div className="ws-broker-decision-head"><div><span className="ws-label">READ-ONLY DECISION</span><h3>Ask what your limits would do.</h3>
        <p>Check a proposed buy against your saved mandate and fresh broker evidence. This never places an order.</p></div>
        <button type="button" className="ws-broker-history-button" onClick={loadHistory} disabled={historyBusy}>{historyBusy ? "Loading…" : "Load saved checks"}</button></div>
      {mandate.version < 1 ? <div className="ws-broker-needs-mandate"><p>Save your limits in Mandate before checking a proposal.</p><button type="button" onClick={onOpenMandate}>Set my limits <ArrowRight size={15}/></button></div> :
        <form className="ws-broker-proposal" onSubmit={checkProposal}>
          <label>Stock symbol<input value={symbol} onChange={event => setSymbol(event.target.value)} maxLength={8} autoCapitalize="characters" autoComplete="off" /></label>
          <label>Proposed buy · USD<input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" /></label>
          <button type="submit" disabled={checkBusy}>{checkBusy ? "Checking…" : "Check without buying"}</button>
        </form>}
      {checkError && <p className="ws-error" role="alert">{checkError}</p>}
      {record && <div role="status" aria-live="polite"><RecordDetails record={record}/></div>}
      {plan && status?.tradingScope && status.orderSubmissionEnabled && <div className="ws-broker-approve">
        <p>Every limit passed and this check is ready for your exact approval. One order of <strong>{plan.order.notional} USD · {plan.order.symbol}</strong> would be submitted to your connected {status.environment} account. {status.environment === "paper" ? "This is the paper sandbox — no real money moves." : "This is a real-money order."}</p>
        <button type="button" onClick={approveOrder} disabled={approveBusy}>{approveBusy ? "Submitting one order…" : "Approve & submit this order"}</button>
      </div>}
      {history && <div className="ws-broker-history"><h4>Saved checks</h4>{history.length === 0 ? <p>No broker checks saved for this account yet.</p> : history.map(item =>
        <details key={item.id}><summary>{item.proposal.symbol} · {dollars(item.proposal.amountCents)} · {new Date(item.createdAt).toLocaleString()}</summary><RecordDetails record={item}/></details>)}</div>}
    </div>}
    {status && <div className="ws-agent-decisions">
      <div className="ws-broker-decision-head"><div><span className="ws-label">AUTOMATIC DECISIONS</span>
        <h3>Let Steward decide for you.</h3>
        <p>Pick one stock and an amount. Throughout the market day Steward checks it against your saved limits on its own — no prompt from you — and records every decision here. {status.environment === "paper" ? "This paper account can also submit passing orders by itself when you turn that on below." : "Automatic order submission is only available on the paper account."}</p></div>
        {agentPlan && <span className="ws-agent-state">{agentPlan.enabled ? "RUNNING" : "STOPPED"}</span>}</div>
      {mandate.version < 1 ? <div className="ws-broker-needs-mandate"><p>Save your limits in Mandate before enabling automatic decisions.</p><button type="button" onClick={onOpenMandate}>Set my limits <ArrowRight size={15}/></button></div> :
        <form className="ws-agent-form" onSubmit={event => { event.preventDefault(); saveAgent(true); }}>
          <label>Stock symbol<input value={agentSymbol} onChange={event => setAgentSymbol(event.target.value)} maxLength={8} autoCapitalize="characters" autoComplete="off" /></label>
          <label>Amount per decision · USD<input value={agentAmount} onChange={event => setAgentAmount(event.target.value)} inputMode="decimal" autoComplete="off" /></label>
          <label className="ws-agent-checkbox"><input type="checkbox" checked={agentSubmit}
            disabled={!(status.tradingScope && status.orderSubmissionEnabled && status.environment === "paper")}
            onChange={event => setAgentSubmit(event.target.checked)} />
            <span>Also submit passing orders automatically on the paper account. No real money moves.{!(status.tradingScope && status.orderSubmissionEnabled && status.environment === "paper") ? " Unlocks when trading permission is granted on the paper account." : ""}</span></label>
          <div className="ws-agent-actions">
            <button type="submit" disabled={agentBusy}>{agentBusy ? "Saving…" : agentPlan?.enabled ? "Update plan" : "Start automatic decisions"}</button>
            {agentPlan?.enabled && <button type="button" className="ws-broker-disconnect" onClick={() => saveAgent(false)} disabled={agentBusy}>Stop</button>}
          </div>
        </form>}
      {agentError && <p className="ws-error" role="alert">{agentError}</p>}
      {agentPlan && <p className="ws-broker-meta">{agentPlan.enabled ? `Running · ${agentPlan.symbol} · ${dollars(agentPlan.amountCents)} per decision.` : "Stopped."} {agentPlan.lastDecisionAt ? `Last decision ${new Date(agentPlan.lastDecisionAt).toLocaleString()} · ${agentPlan.decisionsToday} today.` : "No decision made yet."}</p>}
    </div>}
  </section>;
}
