import assert from "node:assert/strict";
import test from "node:test";
import { checkWithBroker, type BrokerReader, type DecisionLedger } from "./broker-boundary.ts";
import type { BrokerSnapshot, DecisionReceipt, Mandate } from "./decision.ts";

const now = new Date("2026-09-24T12:00:00.000Z");
const mandate: Mandate = { version: 1, allowedSymbols: ["AAPL"], maxOrderCents: 10_000, maxDailyBuyCents: 10_000, maxPositionBps: 2_000, requireApproval: true };
const snapshot: BrokerSnapshot = { source: "authenticated_broker_adapter", observedAt: now.toISOString(), accountRef: "account-1", symbol: "AAPL", quoteCents: 20_000, quoteObservedAt: now.toISOString(), positionValueCents: 0, portfolioValueCents: 100_000, buyingPowerCents: 50_000, executedBuysTodayCents: 0, openBuyOrdersTodayCents: 0, openBuyOrdersForSymbolCents: 0, tradable: true };

test("server broker check reads account evidence and persists its decision", async () => {
  const saved: DecisionReceipt[] = [];
  const reader: BrokerReader = { source: "authenticated_broker_adapter", readSnapshot: async () => snapshot };
  const ledger: DecisionLedger = { getMandate: async () => mandate, saveDecision: async (_owner, receipt) => { saved.push(receipt); } };
  const receipt = await checkWithBroker(reader, ledger, { ownerRef: "owner-1", accountRef: "account-1", proposal: { symbol: "AAPL", amountCents: 5_000 } }, now);
  assert.equal(receipt.status, "awaiting_approval");
  assert.equal(saved[0]?.id, receipt.id);
});

test("mismatched broker account cannot create a receipt", async () => {
  let saved = false;
  const reader: BrokerReader = { source: "authenticated_broker_adapter", readSnapshot: async () => ({ ...snapshot, accountRef: "other-account" }) };
  const ledger: DecisionLedger = { getMandate: async () => mandate, saveDecision: async () => { saved = true; } };
  await assert.rejects(checkWithBroker(reader, ledger, { ownerRef: "owner-1", accountRef: "account-1", proposal: { symbol: "AAPL", amountCents: 5_000 } }, now), /does not match/);
  assert.equal(saved, false);
});

test("mismatched broker source cannot create a receipt", async () => {
  let saved = false;
  const reader: BrokerReader = { source: "another_broker_adapter", readSnapshot: async () => snapshot };
  const ledger: DecisionLedger = { getMandate: async () => mandate, saveDecision: async () => { saved = true; } };
  await assert.rejects(checkWithBroker(reader, ledger, { ownerRef: "owner-1", accountRef: "account-1", proposal: { symbol: "AAPL", amountCents: 5_000 } }, now), /does not match/);
  assert.equal(saved, false);
});
