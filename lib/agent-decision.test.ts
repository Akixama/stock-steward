import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { D1DecisionLedger } from "../db/ledger.ts";
import { loadAgentPlan, saveAgentPlan } from "../db/agent-plans.ts";
import { validateAgentProposal, agentRunDue, canAutoSubmit, runAgentDecision,
  type AgentDecisionStore, type AgentPlan } from "./agent-decision.ts";
import type { BrokerReader } from "./broker-boundary.ts";
import type { OrderGateway } from "./order-flow.ts";
import type { BrokerSnapshot, DecisionReceipt, Mandate } from "./decision.ts";
import type { ApprovalPlan } from "./approval-plan.ts";
import type { BrokerOrder } from "./alpaca-order.ts";

function database() {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`CREATE TABLE mandates(owner_ref TEXT, version INTEGER, policy_json TEXT, created_at TEXT, PRIMARY KEY(owner_ref, version));
    CREATE TABLE decision_receipts(id TEXT PRIMARY KEY, owner_ref TEXT, account_ref TEXT, policy_version INTEGER, status TEXT, receipt_json TEXT, created_at TEXT);
    CREATE TABLE order_events(receipt_id TEXT, sequence INTEGER, owner_ref TEXT, event_json TEXT, created_at TEXT, PRIMARY KEY(receipt_id, sequence));
    CREATE TABLE account_order_gates(owner_ref TEXT, account_ref TEXT, active_receipt_id TEXT, last_completed_at TEXT, updated_at TEXT, PRIMARY KEY(owner_ref, account_ref));
    CREATE TABLE agent_plans(owner_ref TEXT PRIMARY KEY, symbol TEXT, amount_cents INTEGER, submit_on_paper INTEGER, enabled INTEGER, day TEXT, decisions_today INTEGER, last_decision_at TEXT, last_receipt_id TEXT, updated_at TEXT);`);
  const db = {
    prepare(q: string) {
      let args: (string | number | null)[] = [];
      const stmt = {
        bind(...values: typeof args) { args = values; return stmt; },
        async first() { return sql.prepare(q).get(...args) ?? null; },
        async all() { return { results: sql.prepare(q).all(...args) }; },
        async run() { return { meta: { changes: Number(sql.prepare(q).run(...args).changes) } }; },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { sql, db };
}

function storeFor(db: D1Database): AgentDecisionStore {
  return Object.assign(new D1DecisionLedger(db), {
    saveAgentState: (plan: AgentPlan) => saveAgentPlan(db, plan),
  });
}

function mandate(overrides: Partial<Mandate> = {}): Mandate {
  return { version: 1, allowedSymbols: ["AAPL", "MSFT"], maxOrderCents: 500,
    maxDailyBuyCents: 2000, maxPositionBps: 2000,
    executionPreference: "automatic", requireApproval: true, ...overrides };
}

function evidence(overrides: Partial<BrokerSnapshot> = {}): BrokerSnapshot {
  const now = new Date().toISOString();
  return { source: "alpaca_connect", observedAt: now, accountRef: "acct-1", symbol: "AAPL",
    quoteCents: 18000, quoteObservedAt: now, positionValueCents: 0, portfolioValueCents: 100000,
    buyingPowerCents: 50000, executedBuysTodayCents: 0, openBuyOrdersTodayCents: 0,
    openBuyOrdersForSymbolCents: 0, tradable: true, ...overrides };
}

class FakeReader implements BrokerReader {
  readonly source = "alpaca_connect";
  calls = 0;
  error: Error | null = null;
  snapshot: Partial<BrokerSnapshot> = {};
  async readSnapshot(_accountRef: string, symbol: string): Promise<BrokerSnapshot> {
    this.calls++;
    if (this.error) throw this.error;
    return evidence({ symbol, ...this.snapshot });
  }
}

class FakeGateway implements OrderGateway {
  submits: ApprovalPlan[] = [];
  failSubmit = false;
  status: BrokerOrder["status"] = "filled";
  async submit(plan: ApprovalPlan): Promise<BrokerOrder> {
    this.submits.push(plan);
    if (this.failSubmit) throw new Error("Broker order response was 500; reconcile by client order ID.");
    return { id: `broker-${this.submits.length}`, clientOrderId: plan.order.client_order_id,
      symbol: plan.order.symbol, notionalCents: Math.round(Number(plan.order.notional) * 100),
      status: this.status, filledCents: this.status === "filled" ? Math.round(Number(plan.order.notional) * 100) : 0 };
  }
  async findByClientOrderId(): Promise<BrokerOrder | null> { return null; }
}

function plan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return { ownerRef: "owner-1", symbol: "AAPL", amountCents: 100, submitOnPaper: false,
    enabled: true, day: "", decisionsToday: 0, lastDecisionAt: null,
    lastReceiptId: null, updatedAt: new Date().toISOString(), ...overrides };
}

async function seedMandate(db: D1Database, m: Mandate) {
  await new D1DecisionLedger(db).saveMandate("owner-1", m);
}

function autoContext(overrides: Partial<Parameters<typeof canAutoSubmit>[0]> = {}) {
  return { plan: plan({ submitOnPaper: true }), mandate: mandate(),
    environment: "paper" as const, tradingScope: true, submissionEnabled: true, ...overrides };
}

test("validateAgentProposal enforces the saved mandate", () => {
  const m = mandate();
  assert.throws(() => validateAgentProposal({ symbol: "TSLA", amountCents: 100 }, m), /not in your approved list/);
  assert.throws(() => validateAgentProposal({ symbol: "AAPL", amountCents: 50 }, m), /at least \$1\.00/);
  assert.throws(() => validateAgentProposal({ symbol: "AAPL", amountCents: 501 }, m), /one-order limit/);
  assert.throws(() => validateAgentProposal({ symbol: "AAPL", amountCents: 100 }, null), /Save your limits/);
  assert.doesNotThrow(() => validateAgentProposal({ symbol: "AAPL", amountCents: 500 }, m));
});

test("agentRunDue bounds cadence and daily volume", () => {
  const now = new Date("2026-10-09T12:00:00.000Z");
  assert.equal(agentRunDue(plan({ enabled: false }), now), "disabled");
  assert.equal(agentRunDue(plan({ day: "2026-10-09", decisionsToday: 8 }), now), "daily_cap");
  assert.equal(agentRunDue(plan({ lastDecisionAt: "2026-10-09T11:45:00.000Z" }), now), "recent");
  assert.equal(agentRunDue(plan({ lastDecisionAt: "2026-10-09T11:29:00.000Z" }), now), null);
  assert.equal(agentRunDue(plan({ day: "2026-10-08", decisionsToday: 8, lastDecisionAt: "2026-10-08T16:00:00.000Z" }), now), null);
});

test("canAutoSubmit requires every gate and never live accounts", () => {
  assert.equal(canAutoSubmit(autoContext()), true);
  assert.equal(canAutoSubmit(autoContext({ plan: plan({ submitOnPaper: true, enabled: false }) })), false);
  assert.equal(canAutoSubmit(autoContext({ plan: plan() })), false);
  assert.equal(canAutoSubmit(autoContext({ mandate: mandate({ executionPreference: "approval" }) })), false);
  assert.equal(canAutoSubmit(autoContext({ mandate: mandate({ executionPreference: undefined }) })), false);
  assert.equal(canAutoSubmit(autoContext({ tradingScope: false })), false);
  assert.equal(canAutoSubmit(autoContext({ submissionEnabled: false })), false);
  // The hard gate: even with every other switch on, live never auto-submits.
  assert.equal(canAutoSubmit(autoContext({ environment: "live" })), false);
});

test("a not-due plan never reaches the broker", async () => {
  const { db } = database();
  await seedMandate(db, mandate());
  const reader = new FakeReader();
  const result = await runAgentDecision({
    plan: plan({ lastDecisionAt: new Date().toISOString() }),
    mandate: mandate(), accountRef: "acct-1", environment: "paper",
    tradingScope: true, submissionEnabled: true,
    store: storeFor(db), reader, gateway: new FakeGateway(),
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "recent");
  assert.equal(reader.calls, 0);
});

test("a plan outside the current mandate is skipped without a check", async () => {
  const { db } = database();
  const reader = new FakeReader();
  const result = await runAgentDecision({
    plan: plan({ symbol: "TSLA" }),
    mandate: mandate(), accountRef: "acct-1", environment: "paper",
    tradingScope: true, submissionEnabled: true,
    store: storeFor(db), reader, gateway: new FakeGateway(),
  });
  assert.equal(result.status, "skipped");
  assert.match(result.reason ?? "", /not in your approved list/);
  assert.equal(reader.calls, 0);
});

test("a closed market is a quiet skip, not a decision", async () => {
  const { db } = database();
  await seedMandate(db, mandate());
  const reader = new FakeReader();
  reader.error = new Error("The US stock market is closed. Next regular session: 9 October 2026 13:30 (UTC). No decision was made and no order was sent.");
  const result = await runAgentDecision({
    plan: plan(), mandate: mandate(), accountRef: "acct-1", environment: "paper",
    tradingScope: true, submissionEnabled: true,
    store: storeFor(db), reader, gateway: new FakeGateway(),
  });
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "market_closed");
  assert.equal(await loadAgentPlan(db, "owner-1"), null);
});

test("the agent records a held decision with its own provenance", async () => {
  const { db } = database();
  await seedMandate(db, mandate());
  const reader = new FakeReader();
  reader.snapshot = { buyingPowerCents: 50 }; // the proposal cannot be afforded
  const gateway = new FakeGateway();
  const result = await runAgentDecision({
    plan: plan(), mandate: mandate(), accountRef: "acct-1", environment: "paper",
    tradingScope: true, submissionEnabled: true,
    store: storeFor(db), reader, gateway,
  });
  assert.equal(result.status, "held");
  const receipt = await new D1DecisionLedger(db).getDecision("owner-1", result.receiptId!);
  assert.equal(receipt?.proposedBy, "steward_agent");
  assert.match(receipt?.why ?? "", /automatically from your saved plan/);
  assert.equal(gateway.submits.length, 0);
  const saved = await loadAgentPlan(db, "owner-1");
  assert.equal(saved?.decisionsToday, 1);
  assert.equal(saved?.lastReceiptId, result.receiptId);
});

test("decide-only mode never submits even when everything passes", async () => {
  const { db } = database();
  await seedMandate(db, mandate());
  const gateway = new FakeGateway();
  const result = await runAgentDecision({
    plan: plan(), mandate: mandate(), accountRef: "acct-1", environment: "paper",
    tradingScope: true, submissionEnabled: true,
    store: storeFor(db), reader: new FakeReader(), gateway,
  });
  assert.equal(result.status, "awaiting_approval");
  assert.match(result.reason ?? "", /decided only/);
  assert.equal(gateway.submits.length, 0);
});

test("paper auto-submit runs the one-attempt pipeline as the steward agent", async () => {
  const { db } = database();
  await seedMandate(db, mandate());
  const gateway = new FakeGateway();
  const result = await runAgentDecision({
    plan: plan({ submitOnPaper: true }), mandate: mandate(),
    accountRef: "acct-1", environment: "paper",
    tradingScope: true, submissionEnabled: true,
    store: storeFor(db), reader: new FakeReader(), gateway,
  });
  assert.equal(result.status, "submitted");
  assert.equal(gateway.submits.length, 1);
  assert.equal(gateway.submits[0].order.symbol, "AAPL");
  assert.equal(gateway.submits[0].order.notional, "1.00");
  const receipt = await new D1DecisionLedger(db).getDecision("owner-1", result.receiptId!);
  assert.equal(receipt?.proposedBy, "steward_agent");
  assert.deepEqual(receipt?.orderEvents.map((event) => event.type),
    ["authorized", "submission_started", "submitted", "filled"]);
  const firstEvent = receipt?.orderEvents[0];
  assert.equal(firstEvent?.type, "authorized");
  if (firstEvent?.type === "authorized") assert.equal(firstEvent.by, "steward_agent");
});

test("the live environment never auto-submits, whatever else is on", async () => {
  const { db } = database();
  await seedMandate(db, mandate());
  const gateway = new FakeGateway();
  const result = await runAgentDecision({
    plan: plan({ submitOnPaper: true }), mandate: mandate(),
    accountRef: "acct-1", environment: "live",
    tradingScope: true, submissionEnabled: true,
    store: storeFor(db), reader: new FakeReader(), gateway,
  });
  assert.equal(result.status, "awaiting_approval");
  assert.match(result.reason ?? "", /paper-only/);
  assert.equal(gateway.submits.length, 0);
});

test("an approval preference or missing trading grant blocks auto-submit", async () => {
  const cases: { mandate?: Mandate; tradingScope?: boolean; submissionEnabled?: boolean; match: RegExp }[] = [
    { mandate: mandate({ executionPreference: "approval" }), match: /preference is approval/ },
    { mandate: mandate({ executionPreference: undefined }), match: /preference is approval/ },
    { tradingScope: false, match: /Trading permission/ },
    { submissionEnabled: false, match: /switched off/ },
  ];
  for (const context of cases) {
    const { db } = database();
    const active = context.mandate ?? mandate();
    await seedMandate(db, active);
    const gateway = new FakeGateway();
    const result = await runAgentDecision({
      plan: plan({ submitOnPaper: true }), mandate: active,
      accountRef: "acct-1", environment: "paper",
      tradingScope: context.tradingScope ?? true, submissionEnabled: context.submissionEnabled ?? true,
      store: storeFor(db), reader: new FakeReader(), gateway,
    });
    assert.equal(result.status, "awaiting_approval");
    assert.match(result.reason ?? "", context.match);
    assert.equal(gateway.submits.length, 0);
  }
});

test("an unknown broker outcome is recorded once and never retried", async () => {
  const { db } = database();
  await seedMandate(db, mandate());
  const gateway = new FakeGateway();
  gateway.failSubmit = true;
  const first = await runAgentDecision({
    plan: plan({ submitOnPaper: true }), mandate: mandate(),
    accountRef: "acct-1", environment: "paper",
    tradingScope: true, submissionEnabled: true,
    store: storeFor(db), reader: new FakeReader(), gateway,
  });
  assert.equal(first.status, "unknown");
  assert.equal(gateway.submits.length, 1);
  const receipt = await new D1DecisionLedger(db).getDecision("owner-1", first.receiptId!);
  assert.deepEqual(receipt?.orderEvents.map((event) => event.type),
    ["authorized", "submission_started", "submission_unknown"]);

  // The next due run makes a fresh decision; the old attempt is never re-sent.
  const second = await runAgentDecision({
    plan: { ...(await loadAgentPlan(db, "owner-1"))!,
      lastDecisionAt: new Date(Date.now() - 45 * 60_000).toISOString() },
    mandate: mandate(), accountRef: "acct-1", environment: "paper",
    tradingScope: true, submissionEnabled: true,
    store: storeFor(db), reader: new FakeReader(), gateway,
  });
  assert.equal(second.status, "aborted");
  assert.equal(gateway.submits.length, 1);
  const again = await new D1DecisionLedger(db).getDecision("owner-1", first.receiptId!);
  assert.deepEqual(again?.orderEvents.map((event) => event.type),
    ["authorized", "submission_started", "submission_unknown"]);
});

test("a submission rejected before any attempt leaves the receipt untouched", async () => {
  const { db } = database();
  await seedMandate(db, mandate({ version: 2, maxOrderCents: 50 }));
  // Plan amount 100 exceeds the new mandate's order cap; validation skips before any check.
  const result = await runAgentDecision({
    plan: plan({ submitOnPaper: true }), mandate: mandate({ version: 2, maxOrderCents: 50 }),
    accountRef: "acct-1", environment: "paper",
    tradingScope: true, submissionEnabled: true,
    store: storeFor(db), reader: new FakeReader(), gateway: new FakeGateway(),
  });
  assert.equal(result.status, "skipped");
  assert.match(result.reason ?? "", /one-order limit/);
});
