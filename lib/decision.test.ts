import assert from "node:assert/strict";
import test from "node:test";
import { addOrderEvent, evaluateBuy, type BrokerSnapshot, type Mandate } from "./decision.ts";

const now = new Date("2026-09-24T12:00:00.000Z");
const mandate: Mandate = {
  version: 3, allowedSymbols: ["AAPL"], maxOrderCents: 10_000,
  maxDailyBuyCents: 20_000, maxPositionBps: 2_000, requireApproval: true,
};
const evidence: BrokerSnapshot = {
  source: "authenticated_broker_adapter", observedAt: now.toISOString(), accountRef: "account-1",
  symbol: "AAPL", quoteCents: 20_000, quoteObservedAt: now.toISOString(), positionValueCents: 5_000,
  portfolioValueCents: 100_000, buyingPowerCents: 50_000,
  executedBuysTodayCents: 0, openBuyOrdersTodayCents: 0, openBuyOrdersForSymbolCents: 0, tradable: true,
};

test("a passing check waits for approval and cannot imply a fill", () => {
  const receipt = evaluateBuy(mandate, evidence, { symbol: "AAPL", amountCents: 10_000 }, now);
  assert.equal(receipt.status, "awaiting_approval");
  assert.equal(receipt.orderEvents.length, 0);
  assert.throws(() => addOrderEvent(receipt, { type: "filled", at: now.toISOString(), brokerOrderId: "order-1", filledCents: 10_000 }));
  const authorized = addOrderEvent(receipt, { type: "authorized", at: now.toISOString(), by: "account_owner" });
  const started = addOrderEvent(authorized, { type: "submission_started", at: now.toISOString(), clientOrderId: "client-1",
    recheckedEvidence: evidence, recheckedChecks: receipt.checks });
  const submitted = addOrderEvent(started, { type: "submitted", at: now.toISOString(), brokerOrderId: "order-1" });
  const filled = addOrderEvent(submitted, { type: "filled", at: now.toISOString(), brokerOrderId: "order-1", filledCents: 10_000 });
  assert.deepEqual(filled.orderEvents.map((event) => event.type), ["authorized", "submission_started", "submitted", "filled"]);
});

test("an automatic preference cannot authorize an order in this version", () => {
  const receipt = evaluateBuy({ ...mandate, executionPreference: "automatic" }, evidence,
    { symbol: "AAPL", amountCents: 10_000 }, now);
  assert.equal(receipt.status, "awaiting_approval");
  assert.equal(receipt.orderEvents.length, 0);
  assert.throws(() => addOrderEvent(receipt, { type: "submitted", at: now.toISOString(), brokerOrderId: "order-1" }),
    /attempted order/);
});

test("a partial fill can end canceled without becoming a full fill", () => {
  const receipt = evaluateBuy(mandate, evidence, { symbol: "AAPL", amountCents: 10_000 }, now);
  const authorized = addOrderEvent(receipt, { type: "authorized", at: now.toISOString(), by: "account_owner" });
  const started = addOrderEvent(authorized, { type: "submission_started", at: now.toISOString(), clientOrderId: "client-1",
    recheckedEvidence: evidence, recheckedChecks: receipt.checks });
  const submitted = addOrderEvent(started, { type: "submitted", at: now.toISOString(), brokerOrderId: "order-1" });
  const partial = addOrderEvent(submitted, { type: "partially_filled", at: now.toISOString(), brokerOrderId: "order-1", filledCents: 3_000 });
  const canceled = addOrderEvent(partial, { type: "canceled", at: now.toISOString(), brokerOrderId: "order-1", filledCents: 3_000 });
  assert.equal(canceled.orderEvents.at(-1)?.type, "canceled");
  assert.throws(() => addOrderEvent(canceled, { type: "filled", at: now.toISOString(),
    brokerOrderId: "order-1", filledCents: 10_000 }), /submitted broker order/);
});

test("an account owner can decline a passing proposal exactly once", () => {
  const receipt = evaluateBuy(mandate, evidence, { symbol: "AAPL", amountCents: 5_000 }, now);
  const declined = addOrderEvent(receipt, { type: "declined", at: now.toISOString(), by: "account_owner" });
  assert.equal(declined.orderEvents.at(-1)?.type, "declined");
  assert.throws(() => addOrderEvent(declined, { type: "authorized", at: now.toISOString(), by: "account_owner" }), /already acted on/);
  assert.throws(() => addOrderEvent(declined, { type: "declined", at: now.toISOString(), by: "account_owner" }), /already acted on/);
});

test("failed limits produce an inspectable hold and block order events", () => {
  const receipt = evaluateBuy(mandate, { ...evidence, openBuyOrdersTodayCents: 15_000 }, { symbol: "AAPL", amountCents: 10_000 }, now);
  assert.equal(receipt.status, "held");
  assert.ok(receipt.checks.some((check) => check.rule === "daily_buy_limit" && !check.passed));
  assert.ok(receipt.changeNeeded.length > 0);
  assert.throws(() => addOrderEvent(receipt, { type: "authorized", at: now.toISOString(), by: "account_owner" }));
});

test("daily exposure counts all open buys while concentration counts this stock only", () => {
  const receipt = evaluateBuy(mandate, { ...evidence, openBuyOrdersTodayCents: 9_000, openBuyOrdersForSymbolCents: 0 }, { symbol: "AAPL", amountCents: 10_000 }, now);
  assert.equal(receipt.checks.find((check) => check.rule === "daily_buy_limit")?.observed, "$190.00");
  assert.equal(receipt.checks.find((check) => check.rule === "position_concentration")?.observed, "15.00%");
});

test("stale broker evidence creates no decision", () => {
  assert.throws(() => evaluateBuy(mandate, { ...evidence, observedAt: "2026-09-24T11:58:00.000Z" }, { symbol: "AAPL", amountCents: 10_000 }, now), /stale/);
});

test("a recent account read cannot make an old quote look fresh", () => {
  assert.throws(() => evaluateBuy(mandate, { ...evidence,
    quoteObservedAt: "2026-09-24T11:59:20.000Z" },
  { symbol: "AAPL", amountCents: 10_000 }, now), /quote is stale/);
});

test("an invalid broker source creates no decision", () => {
  assert.throws(() => evaluateBuy(mandate, { ...evidence, source: "" },
    { symbol: "AAPL", amountCents: 10_000 }, now), /incomplete/);
});

test("concentration uses existing account equity rather than adding the purchase", () => {
  const receipt = evaluateBuy({ ...mandate, maxPositionBps: 1_400 }, evidence, { symbol: "AAPL", amountCents: 10_000 }, now);
  const concentration = receipt.checks.find((check) => check.rule === "position_concentration");
  assert.equal(concentration?.observed, "15.00%");
  assert.equal(concentration?.passed, false);
});
