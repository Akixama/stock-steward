import assert from "node:assert/strict";
import test from "node:test";
import { confirmExactApproval, prepareAlpacaApproval } from "./approval-plan.ts";
import { addOrderEvent, evaluateBuy, type BrokerSnapshot, type Mandate } from "./decision.ts";

const now = new Date("2026-09-24T12:00:00.000Z");
const mandate: Mandate = {
  version: 3, allowedSymbols: ["AAPL"], maxOrderCents: 10_000,
  maxDailyBuyCents: 25_000, maxPositionBps: 2_000, requireApproval: true,
};
const evidence: BrokerSnapshot = {
  source: "alpaca_connect", observedAt: now.toISOString(), accountRef: "account-1",
  symbol: "AAPL", quoteCents: 20_000, quoteObservedAt: now.toISOString(), positionValueCents: 0,
  portfolioValueCents: 100_000, buyingPowerCents: 50_000,
  executedBuysTodayCents: 0, openBuyOrdersTodayCents: 0,
  openBuyOrdersForSymbolCents: 0, tradable: true,
};
const proposal = { symbol: "AAPL", amountCents: 5_000 };

test("plans an exact, short-lived dollar buy from a fresh passing receipt", () => {
  const receipt = evaluateBuy(mandate, evidence, proposal, now);
  const plan = prepareAlpacaApproval(receipt, mandate, "account-1", now);
  assert.deepEqual(plan.order, {
    symbol: "AAPL", notional: "50.00", side: "buy", type: "market",
    time_in_force: "day", client_order_id: `ss_${receipt.id.replaceAll("-", "")}`,
  });
  assert.equal(plan.expiresAt, "2026-09-24T12:00:30.000Z");
  confirmExactApproval(plan, { receiptId: receipt.id, accountRef: "account-1",
    symbol: "AAPL", notional: "50.00" }, new Date("2026-09-24T12:00:10.000Z"));
  assert.throws(() => confirmExactApproval(plan, { receiptId: receipt.id, accountRef: "account-1",
    symbol: "AAPL", notional: "50.01" }, now), /changed/);
  assert.throws(() => confirmExactApproval(plan, { receiptId: receipt.id, accountRef: "account-1",
    symbol: "AAPL", notional: "50.00" }, new Date("2026-09-24T12:00:31.000Z")), /expired/);
});

test("changed mandate, account, stale evidence, and declined receipts cannot plan an order", () => {
  const receipt = evaluateBuy(mandate, evidence, proposal, now);
  assert.throws(() => prepareAlpacaApproval(receipt, { ...mandate, version: 4 }, "account-1", now), /Mandate changed/);
  assert.throws(() => prepareAlpacaApproval(receipt, mandate, "account-2", now), /account changed/);
  assert.throws(() => prepareAlpacaApproval(receipt, mandate, "account-1",
    new Date("2026-09-24T12:00:31.000Z")), /expired/);
  const declined = addOrderEvent(receipt, { type: "declined", by: "account_owner", at: now.toISOString() });
  assert.throws(() => prepareAlpacaApproval(declined, mandate, "account-1", now), /cannot be approved/);
});

test("held and sub-dollar proposals cannot plan an Alpaca order", () => {
  const held = evaluateBuy(mandate, { ...evidence, buyingPowerCents: 0 }, proposal, now);
  assert.throws(() => prepareAlpacaApproval(held, mandate, "account-1", now), /cannot be approved/);
  const small = evaluateBuy(mandate, evidence, { symbol: "AAPL", amountCents: 99 }, now);
  assert.throws(() => prepareAlpacaApproval(small, mandate, "account-1", now), /supported Alpaca order/);
});

test("order review expires from the actual quote time", () => {
  const olderQuote = { ...evidence, quoteObservedAt: "2026-09-24T11:59:40.000Z" };
  const receipt = evaluateBuy(mandate, olderQuote, proposal, now);
  const plan = prepareAlpacaApproval(receipt, mandate, "account-1", now);
  assert.equal(plan.expiresAt, "2026-09-24T12:00:10.000Z");
  assert.throws(() => prepareAlpacaApproval(receipt, mandate, "account-1",
    new Date("2026-09-24T12:00:10.000Z")), /expired/);
});
