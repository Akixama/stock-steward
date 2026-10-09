import assert from "node:assert/strict";
import test from "node:test";
import { AlpacaOrderGateway } from "./alpaca-order.ts";
import type { AlpacaConnection } from "./alpaca-connection.ts";
import { prepareAlpacaApproval } from "./approval-plan.ts";
import { evaluateBuy, type BrokerSnapshot, type Mandate } from "./decision.ts";

const now = new Date("2026-09-25T12:00:00.000Z");
const mandate: Mandate = { version: 1, allowedSymbols: ["AAPL"], maxOrderCents: 10_000,
  maxDailyBuyCents: 20_000, maxPositionBps: 2_000, requireApproval: true };
const evidence: BrokerSnapshot = { source: "alpaca_connect", observedAt: now.toISOString(),
  quoteObservedAt: now.toISOString(), accountRef: "account-1", symbol: "AAPL", quoteCents: 20_000,
  positionValueCents: 0, portfolioValueCents: 100_000, buyingPowerCents: 50_000,
  executedBuysTodayCents: 0, openBuyOrdersTodayCents: 0,
  openBuyOrdersForSymbolCents: 0, tradable: true };
const receipt = evaluateBuy(mandate, evidence, { symbol: "AAPL", amountCents: 5_000 }, now);
const plan = prepareAlpacaApproval(receipt, mandate, "account-1", now);
const connection: AlpacaConnection = { accountRef: "account-1", environment: "paper",
  connectedAt: now.toISOString(), token: "fake-token", tradingScope: true };
const rawOrder = { id: "broker-order-1", client_order_id: plan.order.client_order_id,
  symbol: "AAPL", notional: "50.000000000", side: "buy", type: "market", time_in_force: "day",
  status: "partially_filled", filled_qty: "0.1", filled_avg_price: "200.00" };

test("submits exactly the approved dollar order once and parses broker status", async () => {
  let calls = 0;
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(input), "https://paper-api.alpaca.markets/v2/orders");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fake-token");
    assert.deepEqual(JSON.parse(String(init?.body)), plan.order);
    return Response.json(rawOrder);
  }) as typeof fetch;
  const order = await new AlpacaOrderGateway(connection, fetcher).submit(plan);
  assert.equal(calls, 1);
  assert.equal(order.filledCents, 2_000);
  assert.equal(order.status, "partially_filled");
});

test("looks up the same client order ID and rejects a mismatched broker response", async () => {
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/v2/orders:by_client_order_id");
    assert.equal(url.searchParams.get("client_order_id"), plan.order.client_order_id);
    assert.equal(init?.method, undefined);
    return Response.json({ ...rawOrder, symbol: "MSFT" });
  }) as typeof fetch;
  await assert.rejects(new AlpacaOrderGateway(connection, fetcher).findByClientOrderId(plan), /does not match/);
});

test("404 lookup is unknown, not proof that a submission can be retried", async () => {
  const fetcher = (async () => new Response(null, { status: 404 })) as typeof fetch;
  assert.equal(await new AlpacaOrderGateway(connection, fetcher).findByClientOrderId(plan), null);
});
