import { checkWithBroker, type BrokerReader, type DecisionLedger } from "./broker-boundary.ts";
import { alpacaOrderForReceipt } from "./approval-plan.ts";
import { approveAndSubmit, type OrderGateway, type OrderLedger } from "./order-flow.ts";
import type { DecisionReceipt, Mandate } from "./decision.ts";

// The automatic decision agent checks one saved stock plan against the mandate on a
// schedule and records the decision without a per-order prompt. It never proposes a
// buy outside the saved plan, never retries a submission, and only ever submits an
// order by itself on a paper account: the live environment is a hard gate below.
export type AgentPlan = {
  ownerRef: string;
  symbol: string;
  amountCents: number;
  submitOnPaper: boolean;
  enabled: boolean;
  day: string;
  decisionsToday: number;
  lastDecisionAt: string | null;
  lastReceiptId: string | null;
  updatedAt: string;
};

export const AGENT_MIN_DECISION_GAP_MS = 30 * 60_000;
export const AGENT_MAX_DECISIONS_PER_DAY = 8;

export type AgentDecisionStore = DecisionLedger & OrderLedger & {
  saveAgentState(plan: AgentPlan): Promise<void>;
};

export type AgentDecisionResult = {
  status: "skipped" | "held" | "awaiting_approval" | "submitted" | "unknown" | "aborted";
  reason?: string;
  receiptId?: string;
  receipt?: DecisionReceipt;
};

export function validateAgentProposal(proposal: { symbol: string; amountCents: number },
  mandate: Mandate | null): void {
  if (!mandate || !Number.isInteger(mandate.version) || mandate.version < 1) {
    throw new Error("Save your limits in Mandate first.");
  }
  if (!/^[A-Z.]{1,8}$/.test(proposal.symbol)) throw new Error("Enter a stock symbol.");
  if (!mandate.allowedSymbols.includes(proposal.symbol)) {
    throw new Error("This stock is not in your approved list.");
  }
  if (!Number.isSafeInteger(proposal.amountCents) || proposal.amountCents < 100) {
    throw new Error("Amount must be at least $1.00.");
  }
  if (proposal.amountCents > mandate.maxOrderCents) {
    throw new Error("Amount exceeds your one-order limit.");
  }
}

/** null when a decision is due; otherwise the reason to skip this tick. */
export function agentRunDue(plan: AgentPlan, now = new Date()): string | null {
  if (!plan.enabled) return "disabled";
  const day = now.toISOString().slice(0, 10);
  const count = plan.day === day ? plan.decisionsToday : 0;
  if (count >= AGENT_MAX_DECISIONS_PER_DAY) return "daily_cap";
  if (plan.lastDecisionAt) {
    const last = Date.parse(plan.lastDecisionAt);
    if (Number.isFinite(last) && now.getTime() - last < AGENT_MIN_DECISION_GAP_MS) return "recent";
  }
  return null;
}

export function canAutoSubmit(input: {
  plan: AgentPlan; mandate: Mandate;
  environment: "paper" | "live"; tradingScope: boolean; submissionEnabled: boolean;
}): boolean {
  // environment === "paper" is a hard gate: the agent may never submit a real-money order.
  return input.plan.submitOnPaper === true && input.plan.enabled === true &&
    input.mandate.executionPreference === "automatic" &&
    input.environment === "paper" && input.tradingScope === true &&
    input.submissionEnabled === true;
}

function autoSkipReason(input: {
  plan: AgentPlan; mandate: Mandate;
  environment: "paper" | "live"; tradingScope: boolean; submissionEnabled: boolean;
}): string {
  if (!input.plan.submitOnPaper) return "Paper auto-submit is off for this plan. Steward decided only.";
  if (input.mandate.executionPreference !== "automatic") {
    return "Your saved action preference is approval. Steward decided only.";
  }
  if (input.environment !== "paper") return "Automatic submission is paper-only. Steward decided only.";
  if (!input.tradingScope) return "Trading permission is not granted. Steward decided only.";
  if (!input.submissionEnabled) return "Order submission is switched off. Steward decided only.";
  return "Steward decided only.";
}

export async function runAgentDecision(input: {
  plan: AgentPlan; mandate: Mandate | null;
  accountRef: string; environment: "paper" | "live";
  tradingScope: boolean; submissionEnabled: boolean;
  store: AgentDecisionStore; reader: BrokerReader; gateway: OrderGateway;
}, now = new Date()): Promise<AgentDecisionResult> {
  const due = agentRunDue(input.plan, now);
  if (due) return { status: "skipped", reason: due };
  try {
    validateAgentProposal({ symbol: input.plan.symbol, amountCents: input.plan.amountCents }, input.mandate);
  } catch (error) {
    return { status: "skipped", reason: error instanceof Error ? error.message : "Plan no longer matches your limits." };
  }
  const mandate = input.mandate!;

  let receipt: DecisionReceipt;
  try {
    receipt = await checkWithBroker(input.reader, input.store, {
      ownerRef: input.plan.ownerRef, accountRef: input.accountRef,
      proposal: { symbol: input.plan.symbol, amountCents: input.plan.amountCents },
      proposedBy: "steward_agent",
    }, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The check failed.";
    return { status: "skipped", reason: message.includes("market is closed") ? "market_closed" : message };
  }

  const day = now.toISOString().slice(0, 10);
  const state: AgentPlan = {
    ...input.plan, day,
    decisionsToday: input.plan.day === day ? input.plan.decisionsToday + 1 : 1,
    lastDecisionAt: now.toISOString(), lastReceiptId: receipt.id,
    updatedAt: now.toISOString(),
  };
  await input.store.saveAgentState(state);

  if (receipt.status === "held") return { status: "held", receiptId: receipt.id, receipt };

  const autoContext = {
    plan: input.plan, mandate: mandate,
    environment: input.environment, tradingScope: input.tradingScope,
    submissionEnabled: input.submissionEnabled,
  };
  if (!canAutoSubmit(autoContext)) {
    return { status: "awaiting_approval", receiptId: receipt.id, receipt, reason: autoSkipReason(autoContext) };
  }

  // Paper auto-submit: the same one-attempt pipeline as a manual approval, recorded
  // honestly as the steward agent's action under the saved automatic preference.
  try {
    const order = alpacaOrderForReceipt(receipt);
    const updated = await approveAndSubmit({
      ownerRef: input.plan.ownerRef, receiptId: receipt.id, accountRef: input.accountRef,
      acknowledgement: { receiptId: receipt.id, accountRef: input.accountRef,
        symbol: order.symbol, notional: order.notional },
      tradingEnabled: true, authorizedBy: "steward_agent",
    }, input.store, input.gateway, input.reader, now);
    const last = updated.orderEvents.at(-1)?.type;
    if (last === "submission_unknown") return { status: "unknown", receiptId: updated.id, receipt: updated };
    if (last === "submission_aborted") return { status: "aborted", receiptId: updated.id, receipt: updated };
    // A fill, partial fill or broker terminal state still means the one attempt went out.
    if (last === "submitted" || last === "partially_filled" || last === "filled" ||
      last === "canceled" || last === "expired" || last === "rejected") {
      return { status: "submitted", receiptId: updated.id, receipt: updated };
    }
    return { status: "awaiting_approval", receiptId: updated.id, receipt: updated };
  } catch (error) {
    // A throw before any order event means nothing reached the broker. Never retry here.
    return { status: "aborted", receiptId: receipt.id, receipt,
      reason: error instanceof Error ? error.message : "Automatic submission was refused." };
  }
}
