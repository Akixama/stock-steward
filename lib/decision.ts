export type Mandate = {
  version: number;
  allowedSymbols: string[];
  maxOrderCents: number;
  maxDailyBuyCents: number;
  maxPositionBps: number;
  executionPreference?: "approval" | "automatic";
  requireApproval: true;
};

// BrokerSnapshot must be built from an authenticated broker response, never browser input.
export type BrokerSnapshot = {
  source: string;
  observedAt: string;
  accountRef: string;
  symbol: string;
  quoteCents: number;
  quoteObservedAt: string;
  positionValueCents: number;
  portfolioValueCents: number;
  buyingPowerCents: number;
  executedBuysTodayCents: number;
  openBuyOrdersTodayCents: number;
  openBuyOrdersForSymbolCents: number;
  tradable: boolean;
};

export type ProposedBuy = { symbol: string; amountCents: number };
// 'steward_agent' marks decisions the saved automatic plan made without a per-order prompt.
export type DecisionActor = "account_owner" | "steward_agent";
export type RuleCheck = {
  rule: string;
  passed: boolean;
  observed: string;
  limit: string;
  explanation: string;
};
export type DecisionReceipt = {
  id: string;
  createdAt: string;
  kind: "decision";
  status: "held" | "awaiting_approval";
  policyVersion: number;
  proposedBy?: DecisionActor;
  proposal: ProposedBuy;
  evidence: BrokerSnapshot;
  checks: RuleCheck[];
  why: string;
  changeNeeded: string[];
  orderEvents: OrderEvent[];
};
export type OrderEvent =
  | { type: "declined"; at: string; by: DecisionActor }
  | { type: "authorized"; at: string; by: DecisionActor }
  | { type: "submission_aborted"; at: string; reason: string }
  | { type: "submission_started"; at: string; clientOrderId: string;
      recheckedEvidence: BrokerSnapshot; recheckedChecks: RuleCheck[] }
  | { type: "submission_unknown"; at: string; reason: string }
  | { type: "submitted"; at: string; brokerOrderId: string }
  | { type: "partially_filled"; at: string; brokerOrderId: string; filledCents: number }
  | { type: "filled"; at: string; brokerOrderId: string; filledCents: number }
  | { type: "canceled" | "expired"; at: string; brokerOrderId: string; filledCents: number }
  | { type: "rejected"; at: string; brokerOrderId: string; reason: string };

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const validCents = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function evaluateBuy(mandate: Mandate, evidence: BrokerSnapshot, proposal: ProposedBuy, now = new Date()): DecisionReceipt {
  const observedAt = Date.parse(evidence.observedAt);
  const quoteObservedAt = Date.parse(evidence.quoteObservedAt);
  if (!Number.isFinite(observedAt) || Math.abs(now.getTime() - observedAt) > 60_000) {
    throw new Error("Broker evidence is stale or has no valid timestamp. No decision was made.");
  }
  if (!Number.isFinite(quoteObservedAt) || now.getTime() - quoteObservedAt > 30_000 ||
    quoteObservedAt - now.getTime() > 5_000 || quoteObservedAt - observedAt > 5_000) {
    throw new Error("Broker quote is stale or has no valid timestamp. No decision was made.");
  }
  if (typeof evidence.source !== "string" || !/^[a-z][a-z0-9_]{2,63}$/.test(evidence.source) || !evidence.accountRef ||
    evidence.symbol !== proposal.symbol || !/^[A-Z.]{1,8}$/.test(proposal.symbol) ||
    !validCents(proposal.amountCents) || proposal.amountCents === 0 ||
    !Number.isInteger(mandate.version) || mandate.version < 1 || evidence.quoteCents === 0 ||
    ![evidence.quoteCents, evidence.positionValueCents, evidence.portfolioValueCents,
      evidence.buyingPowerCents, evidence.executedBuysTodayCents, evidence.openBuyOrdersTodayCents,
      evidence.openBuyOrdersForSymbolCents,
      mandate.maxOrderCents, mandate.maxDailyBuyCents].every(validCents) ||
    !Number.isInteger(mandate.maxPositionBps) || mandate.maxPositionBps < 1 || mandate.maxPositionBps > 10_000 ||
    mandate.requireApproval !== true) {
    throw new Error("Broker evidence or mandate is incomplete. No decision was made.");
  }

  const projectedPosition = evidence.positionValueCents + evidence.openBuyOrdersForSymbolCents + proposal.amountCents;
  // Buying with portfolio cash changes the allocation, not total account equity.
  const projectedPortfolio = evidence.portfolioValueCents;
  const projectedBps = projectedPortfolio > 0 ? Math.ceil(projectedPosition * 10_000 / projectedPortfolio) : 10_000;
  const dailyTotal = evidence.executedBuysTodayCents + evidence.openBuyOrdersTodayCents + proposal.amountCents;
  const checks: RuleCheck[] = [
    { rule: "approved_symbol", passed: mandate.allowedSymbols.includes(proposal.symbol), observed: proposal.symbol,
      limit: mandate.allowedSymbols.join(", ") || "No symbols approved",
      explanation: "The stock must be on your approved list." },
    { rule: "broker_tradability", passed: evidence.tradable, observed: evidence.tradable ? "Tradable" : "Unavailable",
      limit: "Tradable", explanation: "The broker must currently allow this stock to trade." },
    { rule: "order_size", passed: proposal.amountCents <= mandate.maxOrderCents, observed: dollars(proposal.amountCents),
      limit: dollars(mandate.maxOrderCents), explanation: "A single buy cannot exceed your order limit." },
    { rule: "buying_power", passed: proposal.amountCents <= evidence.buyingPowerCents, observed: dollars(evidence.buyingPowerCents),
      limit: dollars(proposal.amountCents), explanation: "Available buying power must cover the proposed buy." },
    { rule: "daily_buy_limit", passed: dailyTotal <= mandate.maxDailyBuyCents, observed: dollars(dailyTotal),
      limit: dollars(mandate.maxDailyBuyCents), explanation: "Today's filled buys and open buy orders count toward your daily limit." },
    { rule: "position_concentration", passed: projectedBps <= mandate.maxPositionBps, observed: `${(projectedBps / 100).toFixed(2)}%`,
      limit: `${(mandate.maxPositionBps / 100).toFixed(2)}%`, explanation: "The projected position cannot exceed your portfolio share limit." },
  ];
  const failed = checks.filter((check) => !check.passed);
  return {
    id: crypto.randomUUID(), createdAt: now.toISOString(), kind: "decision",
    status: failed.length ? "held" : "awaiting_approval", policyVersion: mandate.version,
    proposal: { ...proposal }, evidence: { ...evidence }, checks,
    why: failed.length
      ? `${failed.length} of your limits prevented this buy.`
      : "Every configured limit passed. Your approval is still required before an order can be submitted.",
    changeNeeded: failed.map((check) => `${check.explanation} Observed ${check.observed}; limit ${check.limit}.`),
    orderEvents: [],
  };
}

export function addOrderEvent(receipt: DecisionReceipt, event: OrderEvent): DecisionReceipt {
  const previous = receipt.orderEvents.at(-1);
  if (receipt.status !== "awaiting_approval") throw new Error("A held decision cannot become an order.");
  if ((event.type === "declined" || event.type === "authorized") && previous) {
    throw new Error("This proposal was already acted on.");
  }
  if (event.type === "submission_started" &&
    (previous?.type !== "authorized" || !event.clientOrderId ||
      event.recheckedEvidence?.source !== receipt.evidence.source ||
      event.recheckedEvidence.accountRef !== receipt.evidence.accountRef ||
      event.recheckedEvidence.symbol !== receipt.proposal.symbol ||
      !Array.isArray(event.recheckedChecks) ||
      event.recheckedChecks.length !== receipt.checks.length ||
      event.recheckedChecks.some((check) => !check.passed))) {
    throw new Error("Submission requires authorization and a passing broker recheck.");
  }
  if (event.type === "submission_aborted" &&
    (previous?.type !== "authorized" || !event.reason)) {
    throw new Error("Only an approved, unsent order can be aborted.");
  }
  if (event.type === "submission_unknown" &&
    (previous?.type !== "submission_started" || !event.reason)) {
    throw new Error("Only an attempted submission can have an unknown outcome.");
  }
  if (event.type === "submitted" &&
    (!(["submission_started", "submission_unknown"] as string[]).includes(previous?.type ?? "") || !event.brokerOrderId)) {
    throw new Error("Broker submission requires an attempted order and broker order ID.");
  }
  if (["partially_filled", "filled", "canceled", "expired", "rejected"].includes(event.type)) {
    const submitted = receipt.orderEvents.find((item) => item.type === "submitted");
    if (!submitted || submitted.type !== "submitted" ||
      !("brokerOrderId" in event) || event.brokerOrderId !== submitted.brokerOrderId ||
      !(["submitted", "partially_filled"] as string[]).includes(previous?.type ?? "")) {
      throw new Error("Only a submitted broker order can be reconciled.");
    }
    if ("filledCents" in event && (!validCents(event.filledCents) ||
      (event.type === "filled" && event.filledCents === 0) ||
      (previous?.type === "partially_filled" && event.filledCents < previous.filledCents))) {
      throw new Error("Broker fill amount is invalid.");
    }
    if (event.type === "rejected" && !event.reason) throw new Error("Broker rejection needs a reason.");
  }
  if (!Number.isFinite(Date.parse(event.at))) throw new Error("Order event needs a valid time.");
  return { ...receipt, orderEvents: [...receipt.orderEvents, event] };
}
