import { alpacaOrderForReceipt, confirmExactApproval, prepareAlpacaApproval,
  type ApprovalPlan } from "./approval-plan.ts";
import type { BrokerOrder } from "./alpaca-order.ts";
import { evaluateBuy, type DecisionReceipt, type Mandate, type OrderEvent } from "./decision.ts";
import type { BrokerReader } from "./broker-boundary.ts";

export interface OrderLedger {
  getDecision(ownerRef: string, receiptId: string): Promise<DecisionReceipt | null>;
  getMandate(ownerRef: string): Promise<Mandate | null>;
  listDecisions(ownerRef: string, limit?: number): Promise<DecisionReceipt[]>;
  appendOrderEvent(ownerRef: string, receiptId: string, event: OrderEvent): Promise<DecisionReceipt>;
  claimOrderAttempt(ownerRef: string, accountRef: string, receiptId: string, observedAt: string): Promise<void>;
  releaseOrderAttempt(ownerRef: string, accountRef: string, receiptId: string): Promise<void>;
}

export interface OrderGateway {
  submit(plan: ApprovalPlan): Promise<BrokerOrder>;
  findByClientOrderId(plan: ApprovalPlan): Promise<BrokerOrder | null>;
}

export type ExactAcknowledgement = {
  receiptId: string; accountRef: string; symbol: string; notional: string;
};

function lookupPlan(receipt: DecisionReceipt, accountRef: string): ApprovalPlan {
  if (receipt.evidence.source !== "alpaca_connect" || receipt.evidence.accountRef !== accountRef) {
    throw new Error("Broker account changed. Order lookup stopped.");
  }
  const order = alpacaOrderForReceipt(receipt);
  const started = receipt.orderEvents.find((event) => event.type === "submission_started");
  if (started?.type !== "submission_started" || started.clientOrderId !== order.client_order_id) {
    throw new Error("No matching order attempt exists.");
  }
  return { receiptId: receipt.id, policyVersion: receipt.policyVersion,
    accountRef, observedAt: receipt.evidence.observedAt,
    quoteObservedAt: receipt.evidence.quoteObservedAt,
    expiresAt: receipt.evidence.observedAt, quotedAskCents: receipt.evidence.quoteCents,
    order };
}

function latestFilledCents(receipt: DecisionReceipt): number {
  for (let index = receipt.orderEvents.length - 1; index >= 0; index--) {
    const event = receipt.orderEvents[index];
    if ("filledCents" in event) return event.filledCents;
  }
  return 0;
}

function assertMatchingOrder(plan: ApprovalPlan, order: BrokerOrder): void {
  if (order.clientOrderId !== plan.order.client_order_id ||
    order.symbol !== plan.order.symbol ||
    order.notionalCents !== Math.round(Number(plan.order.notional) * 100)) {
    throw new Error("Broker order does not match the approved order.");
  }
}

async function recordBrokerOrder(ledger: OrderLedger, ownerRef: string,
  receipt: DecisionReceipt, order: BrokerOrder, now: Date): Promise<DecisionReceipt> {
  const submitted = receipt.orderEvents.find((event) => event.type === "submitted");
  if (submitted?.type === "submitted" && submitted.brokerOrderId !== order.id) {
    throw new Error("Broker order ID changed. Manual review required.");
  }
  if (!submitted) {
    receipt = await ledger.appendOrderEvent(ownerRef, receipt.id,
      { type: "submitted", at: now.toISOString(), brokerOrderId: order.id });
  }
  const previous = receipt.orderEvents.at(-1);
  if (["filled", "canceled", "expired", "rejected"].includes(previous?.type ?? "")) return receipt;
  const filledBefore = latestFilledCents(receipt);
  if (order.status === "partially_filled" && order.filledCents > filledBefore) {
    return ledger.appendOrderEvent(ownerRef, receipt.id, { type: "partially_filled",
      at: now.toISOString(), brokerOrderId: order.id, filledCents: order.filledCents });
  }
  if (order.status === "filled" && order.filledCents >= filledBefore) {
    return ledger.appendOrderEvent(ownerRef, receipt.id, { type: "filled",
      at: now.toISOString(), brokerOrderId: order.id, filledCents: order.filledCents });
  }
  if ((order.status === "canceled" || order.status === "expired") && order.filledCents >= filledBefore) {
    return ledger.appendOrderEvent(ownerRef, receipt.id, { type: order.status,
      at: now.toISOString(), brokerOrderId: order.id, filledCents: order.filledCents });
  }
  if (order.status === "rejected") {
    return ledger.appendOrderEvent(ownerRef, receipt.id, { type: "rejected",
      at: now.toISOString(), brokerOrderId: order.id, reason: "Broker reported the order as rejected." });
  }
  return receipt;
}

/** One POST at most. Unknown outcomes are looked up by client ID; POST is never retried. */
export async function approveAndSubmit(input: {
  ownerRef: string; receiptId: string; accountRef: string;
  acknowledgement: ExactAcknowledgement; tradingEnabled: boolean;
}, ledger: OrderLedger, broker: OrderGateway, reader: BrokerReader,
now = new Date()): Promise<DecisionReceipt> {
  if (!input.tradingEnabled) throw new Error("Broker order submission is disabled.");
  const [receipt, mandate] = await Promise.all([
    ledger.getDecision(input.ownerRef, input.receiptId), ledger.getMandate(input.ownerRef),
  ]);
  if (!receipt || !mandate) throw new Error("Decision or current mandate is unavailable.");
  const plan = prepareAlpacaApproval(receipt, mandate, input.accountRef, now);
  confirmExactApproval(plan, input.acknowledgement, now);
  // Unique event sequence makes concurrent approvals or a concurrent decline lose closed.
  await ledger.appendOrderEvent(input.ownerRef, receipt.id,
    { type: "authorized", at: now.toISOString(), by: "account_owner" });
  let claimed = false;
  let recheck: DecisionReceipt;
  try {
    await ledger.claimOrderAttempt(input.ownerRef, input.accountRef, receipt.id, receipt.evidence.observedAt);
    claimed = true;
    const latestMandate = await ledger.getMandate(input.ownerRef);
    if (latestMandate?.version !== plan.policyVersion) {
      throw new Error("Mandate changed after approval. No order was submitted.");
    }
    const freshEvidence = await reader.readSnapshot(input.accountRef, plan.order.symbol);
    if (reader.source !== freshEvidence.source || freshEvidence.accountRef !== input.accountRef ||
      freshEvidence.symbol !== plan.order.symbol) {
      throw new Error("Broker recheck changed account or stock. No order was submitted.");
    }
    recheck = evaluateBuy(latestMandate, freshEvidence, receipt.proposal, new Date());
    if (recheck.status !== "awaiting_approval") {
      throw new Error("A limit failed on the fresh broker recheck. No order was submitted; create a new decision.");
    }
    confirmExactApproval(plan, input.acknowledgement, new Date());
  } catch (error) {
    const aborted = await ledger.appendOrderEvent(input.ownerRef, receipt.id,
      { type: "submission_aborted", at: new Date().toISOString(),
        reason: error instanceof Error ? error.message : "Order review expired before submission." });
    if (claimed) await ledger.releaseOrderAttempt(input.ownerRef, input.accountRef, receipt.id);
    return aborted;
  }
  let updated = await ledger.appendOrderEvent(input.ownerRef, receipt.id,
    { type: "submission_started", at: new Date().toISOString(), clientOrderId: plan.order.client_order_id,
      recheckedEvidence: recheck.evidence, recheckedChecks: recheck.checks });
  let order: BrokerOrder;
  try {
    order = await broker.submit(plan);
    assertMatchingOrder(plan, order);
  } catch {
    // A timeout or error response does not prove that Alpaca rejected the order.
    updated = await ledger.appendOrderEvent(input.ownerRef, receipt.id,
      { type: "submission_unknown", at: new Date().toISOString(),
        reason: "Broker submission outcome is unknown. Look up the client order ID; do not retry." });
    return updated;
  }
  updated = await recordBrokerOrder(ledger, input.ownerRef, updated, order, new Date());
  if (["filled", "canceled", "expired", "rejected"].includes(updated.orderEvents.at(-1)?.type ?? "")) {
    await ledger.releaseOrderAttempt(input.ownerRef, input.accountRef, receipt.id);
  }
  return updated;
}

/** Read-only broker lookup reconciles a possibly accepted order without another POST. */
export async function reconcileOrder(input: { ownerRef: string; receiptId: string; accountRef: string },
  ledger: OrderLedger, broker: OrderGateway, now = new Date()): Promise<{
  receipt: DecisionReceipt; brokerStatus: BrokerOrder["status"] | "not_found";
}> {
  let receipt = await ledger.getDecision(input.ownerRef, input.receiptId);
  if (!receipt) throw new Error("Decision not found for this account owner.");
  const plan = lookupPlan(receipt, input.accountRef);
  const order = await broker.findByClientOrderId(plan);
  if (!order) {
    if (receipt.orderEvents.at(-1)?.type === "submission_started") {
      receipt = await ledger.appendOrderEvent(input.ownerRef, receipt.id,
        { type: "submission_unknown", at: now.toISOString(),
          reason: "Broker lookup found no order yet. Do not retry submission." });
    }
    return { receipt, brokerStatus: "not_found" };
  }
  assertMatchingOrder(plan, order);
  receipt = await recordBrokerOrder(ledger, input.ownerRef, receipt, order, now);
  if (["filled", "canceled", "expired", "rejected"].includes(receipt.orderEvents.at(-1)?.type ?? "")) {
    await ledger.releaseOrderAttempt(input.ownerRef, input.accountRef, receipt.id);
  }
  return { receipt, brokerStatus: order.status };
}

export type OpenOrderRefresh = {
  checked: number;
  receipts: DecisionReceipt[];
  notFound: string[];
  failures: { receiptId: string; error: string }[];
};

/** Refresh the 50 visible receipts. This performs broker GETs only and never submits an order. */
export async function refreshOpenOrders(input: { ownerRef: string; accountRef: string },
  ledger: OrderLedger, broker: OrderGateway, now = new Date()): Promise<OpenOrderRefresh> {
  const recent = await ledger.listDecisions(input.ownerRef, 50);
  const result: OpenOrderRefresh = { checked: 0, receipts: [], notFound: [], failures: [] };
  for (const receipt of recent) {
    if (receipt.evidence.source !== "alpaca_connect" || receipt.evidence.accountRef !== input.accountRef) continue;
    const last = receipt.orderEvents.at(-1);
    if (!last) continue;
    // submission_started is committed before POST. An older authorization with no
    // attempt therefore cannot have reached the broker through this flow.
    if (last.type === "authorized") {
      if (now.getTime() - Date.parse(last.at) < 60_000) continue;
      try {
        const aborted = await ledger.appendOrderEvent(input.ownerRef, receipt.id,
          { type: "submission_aborted", at: now.toISOString(),
            reason: "Approval did not reach an order attempt. No order was submitted." });
        await ledger.releaseOrderAttempt(input.ownerRef, input.accountRef, receipt.id);
        result.receipts.push(aborted);
      } catch (error) {
        result.failures.push({ receiptId: receipt.id,
          error: error instanceof Error ? error.message : "Could not close the unsent approval." });
      }
      continue;
    }
    if (!["submission_started", "submission_unknown", "submitted", "partially_filled"].includes(last.type)) continue;
    result.checked++;
    try {
      const refreshed = await reconcileOrder({ ...input, receiptId: receipt.id }, ledger, broker, now);
      result.receipts.push(refreshed.receipt);
      if (refreshed.brokerStatus === "not_found") result.notFound.push(receipt.id);
    } catch (error) {
      result.failures.push({ receiptId: receipt.id,
        error: error instanceof Error ? error.message : "Broker lookup failed." });
    }
  }
  return result;
}
