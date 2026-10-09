import assert from "node:assert/strict";
import test from "node:test";
import { addOrderEvent, evaluateBuy, type BrokerSnapshot, type DecisionReceipt,
  type Mandate, type OrderEvent } from "./decision.ts";
import { approveAndSubmit, reconcileOrder, refreshOpenOrders,
  type OrderGateway, type OrderLedger } from "./order-flow.ts";
import type { BrokerOrder } from "./alpaca-order.ts";
import type { BrokerReader } from "./broker-boundary.ts";

const now = new Date();
const mandate: Mandate = { version: 1, allowedSymbols: ["AAPL"], maxOrderCents: 10_000,
  maxDailyBuyCents: 20_000, maxPositionBps: 2_000, requireApproval: true };
const evidence: BrokerSnapshot = { source: "alpaca_connect", observedAt: now.toISOString(),
  quoteObservedAt: now.toISOString(), accountRef: "account-1", symbol: "AAPL", quoteCents: 20_000,
  positionValueCents: 0, portfolioValueCents: 100_000, buyingPowerCents: 50_000,
  executedBuysTodayCents: 0, openBuyOrdersTodayCents: 0,
  openBuyOrdersForSymbolCents: 0, tradable: true };
const reader: BrokerReader = { source: "alpaca_connect",
  async readSnapshot(accountRef, symbol) { const at = new Date().toISOString();
    return { ...evidence, accountRef, symbol, observedAt: at, quoteObservedAt: at }; } };

function setup(): { ledger: OrderLedger; receipt: DecisionReceipt; events: () => OrderEvent[] } {
  let receipt = evaluateBuy(mandate, evidence, { symbol: "AAPL", amountCents: 5_000 }, now);
  let activeReceipt: string | null = null;
  let lastCompletedAt: string | null = null;
  return { receipt, events: () => receipt.orderEvents,
    ledger: {
      async getDecision(_owner, id) { return id === receipt.id ? receipt : null; },
      async getMandate() { return mandate; },
      async listDecisions() { return [receipt]; },
      async appendOrderEvent(_owner, id, event) {
        if (id !== receipt.id) throw new Error("Wrong receipt");
        receipt = addOrderEvent(receipt, event);
        return receipt;
      },
      async claimOrderAttempt(_owner, _account, id, observedAt) {
        if (activeReceipt || (lastCompletedAt && observedAt <= lastCompletedAt)) {
          throw new Error("Another order is pending or this decision predates the last order.");
        }
        activeReceipt = id;
      },
      async releaseOrderAttempt(_owner, _account, id) {
        if (activeReceipt === id) {
          activeReceipt = null;
          lastCompletedAt = new Date().toISOString();
        }
      },
    } };
}

function ack(receipt: DecisionReceipt) {
  return { receiptId: receipt.id, accountRef: "account-1", symbol: "AAPL", notional: "50.00" };
}

function brokerOrder(receipt: DecisionReceipt, status: BrokerOrder["status"], filledCents = 0): BrokerOrder {
  return { id: "broker-1", clientOrderId: `ss_${receipt.id.replaceAll("-", "")}`,
    symbol: "AAPL", notionalCents: 5_000, status, filledCents };
}

test("exact owner approval records a single attempt and broker-confirmed partial and final fills", async () => {
  const { ledger, receipt, events } = setup();
  let posts = 0;
  let broker: OrderGateway = {
    async submit() { posts++; return brokerOrder(receipt, "partially_filled", 2_000); },
    async findByClientOrderId() { return brokerOrder(receipt, "filled", 5_000); },
  };
  const input = { ownerRef: "owner-1", receiptId: receipt.id, accountRef: "account-1",
    acknowledgement: ack(receipt), tradingEnabled: true };
  const first = await approveAndSubmit(input, ledger, broker, reader);
  assert.deepEqual(first.orderEvents.map((event) => event.type),
    ["authorized", "submission_started", "submitted", "partially_filled"]);
  const attempt = first.orderEvents[1];
  assert.equal(attempt.type, "submission_started");
  if (attempt.type === "submission_started") {
    assert.equal(attempt.recheckedEvidence.accountRef, "account-1");
    assert.equal(attempt.recheckedChecks.every((check) => check.passed), true);
  }
  await assert.rejects(approveAndSubmit(input, ledger, broker, reader), /cannot be approved/);
  assert.equal(posts, 1);
  const reconciled = await reconcileOrder({ ownerRef: "owner-1", receiptId: receipt.id,
    accountRef: "account-1" }, ledger, broker);
  assert.equal(reconciled.brokerStatus, "filled");
  assert.equal(events().at(-1)?.type, "filled");
  broker = { ...broker, async findByClientOrderId() { return brokerOrder(receipt, "filled", 5_000); } };
  await reconcileOrder({ ownerRef: "owner-1", receiptId: receipt.id, accountRef: "account-1" }, ledger, broker);
  assert.equal(events().length, 5);
});

test("uncertain response never retries POST and lookup can recover the broker order", async () => {
  const { ledger, receipt, events } = setup();
  let posts = 0;
  const broker: OrderGateway = {
    async submit() { posts++; throw new Error("network timeout"); },
    async findByClientOrderId() { return brokerOrder(receipt, "new"); },
  };
  const input = { ownerRef: "owner-1", receiptId: receipt.id, accountRef: "account-1",
    acknowledgement: ack(receipt), tradingEnabled: true };
  const first = await approveAndSubmit(input, ledger, broker, reader);
  assert.equal(first.orderEvents.at(-1)?.type, "submission_unknown");
  await assert.rejects(approveAndSubmit(input, ledger, broker, reader), /cannot be approved/);
  await reconcileOrder({ ownerRef: "owner-1", receiptId: receipt.id,
    accountRef: "account-1" }, ledger, broker);
  assert.equal(posts, 1);
  assert.equal(events().at(-1)?.type, "submitted");
});

test("disabled trading, wrong acknowledgement, and a decline block broker calls", async () => {
  const { ledger, receipt } = setup();
  let posts = 0;
  const broker: OrderGateway = {
    async submit() { posts++; return brokerOrder(receipt, "new"); },
    async findByClientOrderId() { return null; },
  };
  const base = { ownerRef: "owner-1", receiptId: receipt.id, accountRef: "account-1",
    acknowledgement: ack(receipt), tradingEnabled: true };
  await assert.rejects(approveAndSubmit({ ...base, tradingEnabled: false }, ledger, broker, reader), /disabled/);
  await assert.rejects(approveAndSubmit({ ...base,
    acknowledgement: { ...base.acknowledgement, notional: "50.01" } }, ledger, broker, reader), /changed/);
  await ledger.appendOrderEvent("owner-1", receipt.id,
    { type: "declined", at: now.toISOString(), by: "account_owner" });
  await assert.rejects(approveAndSubmit(base, ledger, broker, reader), /cannot be approved/);
  assert.equal(posts, 0);
});

test("missing broker lookup stays unresolved without another submission", async () => {
  const { ledger, receipt, events } = setup();
  const broker: OrderGateway = {
    async submit() { throw new Error("timeout"); },
    async findByClientOrderId() { return null; },
  };
  await approveAndSubmit({ ownerRef: "owner-1", receiptId: receipt.id, accountRef: "account-1",
    acknowledgement: ack(receipt), tradingEnabled: true }, ledger, broker, reader);
  const result = await reconcileOrder({ ownerRef: "owner-1", receiptId: receipt.id,
    accountRef: "account-1" }, ledger, broker);
  assert.equal(result.brokerStatus, "not_found");
  assert.equal(events().at(-1)?.type, "submission_unknown");
});

test("concurrent approval requests create only one broker POST", async () => {
  const { ledger, receipt } = setup();
  let posts = 0;
  const broker: OrderGateway = {
    async submit() { posts++; return brokerOrder(receipt, "new"); },
    async findByClientOrderId() { return null; },
  };
  const input = { ownerRef: "owner-1", receiptId: receipt.id, accountRef: "account-1",
    acknowledgement: ack(receipt), tradingEnabled: true };
  const results = await Promise.allSettled([
    approveAndSubmit(input, ledger, broker, reader), approveAndSubmit(input, ledger, broker, reader),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(posts, 1);
});

test("a mandate change after owner approval is recorded as not sent", async () => {
  const { ledger, receipt, events } = setup();
  let reads = 0;
  const changedLedger: OrderLedger = { ...ledger,
    async getMandate() { reads++; return reads === 1 ? mandate : { ...mandate, version: 2 }; },
  };
  let posts = 0;
  const broker: OrderGateway = {
    async submit() { posts++; return brokerOrder(receipt, "new"); },
    async findByClientOrderId() { return null; },
  };
  const result = await approveAndSubmit({ ownerRef: "owner-1", receiptId: receipt.id,
    accountRef: "account-1", acknowledgement: ack(receipt), tradingEnabled: true },
  changedLedger, broker, reader);
  assert.equal(result.orderEvents.at(-1)?.type, "submission_aborted");
  assert.deepEqual(events().map((event) => event.type), ["authorized", "submission_aborted"]);
  assert.equal(posts, 0);
});

test("fresh broker recheck blocks an order when buying power has fallen", async () => {
  const { ledger, receipt, events } = setup();
  let posts = 0;
  const broker: OrderGateway = {
    async submit() { posts++; return brokerOrder(receipt, "new"); },
    async findByClientOrderId() { return null; },
  };
  const changedReader: BrokerReader = { source: "alpaca_connect",
    async readSnapshot() { const at = new Date().toISOString();
      return { ...evidence, observedAt: at, quoteObservedAt: at, buyingPowerCents: 0 }; } };
  const result = await approveAndSubmit({ ownerRef: "owner-1", receiptId: receipt.id,
    accountRef: "account-1", acknowledgement: ack(receipt), tradingEnabled: true },
  ledger, broker, changedReader);
  assert.equal(result.orderEvents.at(-1)?.type, "submission_aborted");
  assert.deepEqual(events().map((event) => event.type), ["authorized", "submission_aborted"]);
  assert.equal(posts, 0);
});

test("two distinct approvals for one account cannot both submit from the same snapshot", async () => {
  const first = evaluateBuy(mandate, evidence, { symbol: "AAPL", amountCents: 5_000 }, now);
  const second = evaluateBuy(mandate, evidence, { symbol: "AAPL", amountCents: 5_000 }, now);
  const receipts = new Map([[first.id, first], [second.id, second]]);
  let active: string | null = null;
  const ledger: OrderLedger = {
    async getDecision(_owner, id) { return receipts.get(id) ?? null; },
    async getMandate() { return mandate; },
    async listDecisions() { return [...receipts.values()]; },
    async appendOrderEvent(_owner, id, event) {
      const updated = addOrderEvent(receipts.get(id)!, event);
      receipts.set(id, updated);
      return updated;
    },
    async claimOrderAttempt(_owner, _account, id) {
      if (active) throw new Error("Another order is pending.");
      active = id;
    },
    async releaseOrderAttempt() { active = null; },
  };
  let posts = 0;
  const broker: OrderGateway = {
    async submit(plan) { posts++; return brokerOrder(receipts.get(plan.receiptId)!, "new"); },
    async findByClientOrderId() { return null; },
  };
  const input = (receipt: DecisionReceipt) => ({ ownerRef: "owner-1", receiptId: receipt.id,
    accountRef: "account-1", acknowledgement: ack(receipt), tradingEnabled: true });
  const results = await Promise.all([approveAndSubmit(input(first), ledger, broker, reader),
    approveAndSubmit(input(second), ledger, broker, reader)]);
  assert.equal(posts, 1);
  assert.deepEqual(results.map((receipt) => receipt.orderEvents.at(-1)?.type).sort(),
    ["submission_aborted", "submitted"]);
});

test("refresh closes stale unsent approvals without calling the broker", async () => {
  const { ledger, receipt, events } = setup();
  await ledger.appendOrderEvent("owner-1", receipt.id,
    { type: "authorized", at: new Date(now.getTime() - 61_000).toISOString(), by: "account_owner" });
  let calls = 0;
  const broker: OrderGateway = {
    async submit() { calls++; throw new Error("POST must never be called"); },
    async findByClientOrderId() { calls++; return null; },
  };
  const result = await refreshOpenOrders({ ownerRef: "owner-1", accountRef: "account-1" }, ledger, broker, now);
  assert.equal(result.checked, 0);
  assert.equal(result.receipts[0].orderEvents.at(-1)?.type, "submission_aborted");
  assert.equal(events().at(-1)?.type, "submission_aborted");
  assert.equal(calls, 0);
});

test("refresh looks up pending orders once each and never retries a submission", async () => {
  const { ledger, receipt, events } = setup();
  await ledger.appendOrderEvent("owner-1", receipt.id,
    { type: "authorized", at: now.toISOString(), by: "account_owner" });
  await ledger.appendOrderEvent("owner-1", receipt.id,
    { type: "submission_started", at: now.toISOString(), clientOrderId: brokerOrder(receipt, "new").clientOrderId,
      recheckedEvidence: evidence, recheckedChecks: receipt.checks });
  let posts = 0;
  let gets = 0;
  const broker: OrderGateway = {
    async submit() { posts++; throw new Error("POST must never be called"); },
    async findByClientOrderId() { gets++; return brokerOrder(receipt, "filled", 5_000); },
  };
  const first = await refreshOpenOrders({ ownerRef: "owner-1", accountRef: "account-1" }, ledger, broker, now);
  assert.equal(first.checked, 1);
  assert.equal(first.receipts[0].orderEvents.at(-1)?.type, "filled");
  const second = await refreshOpenOrders({ ownerRef: "owner-1", accountRef: "account-1" }, ledger, broker, now);
  assert.equal(second.checked, 0);
  assert.equal(posts, 0);
  assert.equal(gets, 1);
  assert.equal(events().at(-1)?.type, "filled");
});
