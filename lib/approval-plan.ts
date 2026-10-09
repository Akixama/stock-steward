import type { DecisionReceipt, Mandate } from "./decision.ts";

export type AlpacaBuyOrder = {
  symbol: string;
  notional: string;
  side: "buy";
  type: "market";
  time_in_force: "day";
  client_order_id: string;
};

export type ApprovalPlan = {
  receiptId: string;
  policyVersion: number;
  accountRef: string;
  observedAt: string;
  quoteObservedAt: string;
  expiresAt: string;
  quotedAskCents: number;
  order: AlpacaBuyOrder;
};

const MAX_REVIEW_AGE_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 5_000;

export function alpacaOrderForReceipt(receipt: DecisionReceipt): AlpacaBuyOrder {
  const amountCents = receipt.proposal.amountCents;
  if (!Number.isSafeInteger(amountCents) || amountCents < 100 ||
    !/^[A-Z.]{1,8}$/.test(receipt.proposal.symbol) ||
    !/^[0-9a-f-]{36}$/i.test(receipt.id)) {
    throw new Error("This proposal cannot form a supported Alpaca order.");
  }
  return {
    symbol: receipt.proposal.symbol,
    notional: (amountCents / 100).toFixed(2),
    side: "buy",
    type: "market",
    time_in_force: "day",
    client_order_id: `ss_${receipt.id.replaceAll("-", "")}`,
  };
}

/** A server-side order plan, not authorization or a broker submission. */
export function prepareAlpacaApproval(
  receipt: DecisionReceipt,
  currentMandate: Mandate,
  currentAccountRef: string,
  now = new Date(),
): ApprovalPlan {
  if (receipt.status !== "awaiting_approval" || receipt.orderEvents.length !== 0 ||
    receipt.checks.length === 0 || receipt.checks.some((check) => !check.passed)) {
    throw new Error("This decision cannot be approved. Run a new check.");
  }
  if (receipt.evidence.source !== "alpaca_connect" ||
    receipt.evidence.accountRef !== currentAccountRef || !currentAccountRef) {
    throw new Error("Broker account changed. Run a new check.");
  }
  if (currentMandate.requireApproval !== true || receipt.policyVersion !== currentMandate.version ||
    !currentMandate.allowedSymbols.includes(receipt.proposal.symbol) ||
    receipt.proposal.amountCents > currentMandate.maxOrderCents) {
    throw new Error("Mandate changed. Run a new check.");
  }
  const observedAt = Date.parse(receipt.evidence.observedAt);
  const quoteObservedAt = Date.parse(receipt.evidence.quoteObservedAt);
  const createdAt = Date.parse(receipt.createdAt);
  const age = now.getTime() - observedAt;
  const expiresAt = Math.min(observedAt, quoteObservedAt) + MAX_REVIEW_AGE_MS;
  if (!Number.isFinite(age) || !Number.isFinite(quoteObservedAt) || !Number.isFinite(createdAt) ||
    age < -MAX_FUTURE_SKEW_MS || age > MAX_REVIEW_AGE_MS ||
    quoteObservedAt - observedAt > MAX_FUTURE_SKEW_MS || now.getTime() >= expiresAt ||
    createdAt < observedAt - MAX_FUTURE_SKEW_MS || createdAt > now.getTime() + MAX_FUTURE_SKEW_MS) {
    throw new Error("Broker observation expired. Run a new check.");
  }
  if (!Number.isSafeInteger(receipt.evidence.quoteCents) || receipt.evidence.quoteCents <= 0) {
    throw new Error("This proposal cannot form a supported Alpaca order.");
  }
  return {
    receiptId: receipt.id,
    policyVersion: receipt.policyVersion,
    accountRef: currentAccountRef,
    observedAt: receipt.evidence.observedAt,
    quoteObservedAt: receipt.evidence.quoteObservedAt,
    expiresAt: new Date(expiresAt).toISOString(),
    quotedAskCents: receipt.evidence.quoteCents,
    order: alpacaOrderForReceipt(receipt),
  };
}

/** An exact acknowledgement is required in addition to owner identity and a fresh server check. */
export function confirmExactApproval(plan: ApprovalPlan, acknowledgement: {
  receiptId: string; accountRef: string; symbol: string; notional: string;
}, now = new Date()): void {
  if (now.getTime() >= Date.parse(plan.expiresAt)) throw new Error("Order review expired. Run a new check.");
  if (acknowledgement.receiptId !== plan.receiptId ||
    acknowledgement.accountRef !== plan.accountRef ||
    acknowledgement.symbol !== plan.order.symbol ||
    acknowledgement.notional !== plan.order.notional) {
    throw new Error("Order details changed. No authorization was recorded.");
  }
}
