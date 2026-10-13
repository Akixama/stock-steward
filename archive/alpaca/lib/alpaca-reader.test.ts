import assert from "node:assert/strict";
import test from "node:test";
import { AlpacaBrokerReader } from "./alpaca-reader.ts";
import type { AlpacaConnection } from "./alpaca-connection.ts";

const connection: AlpacaConnection = {
  accountRef: "account-1", environment: "paper", connectedAt: new Date().toISOString(),
  token: "test-token", tradingScope: false,
};

function fakeFetch(changes: { quoteTime?: string; orders?: unknown[]; fills?: unknown[];
  marketOpen?: boolean; clockTime?: string } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
    const url = new URL(String(input));
    let data: unknown;
    if (url.pathname === "/v2/clock") data = {
      is_open: changes.marketOpen ?? true, timestamp: changes.clockTime ?? new Date().toISOString(),
      next_open: new Date(Date.now() + 86_400_000).toISOString(),
    };
    else if (url.pathname === "/v2/account") data = {
      id: "account-1", status: "ACTIVE", trading_blocked: false,
      equity: "1000", cash: "500", buying_power: "750",
    };
    else if (url.pathname === "/v2/positions") data = [{ symbol: "AAPL", market_value: "100" }];
    else if (url.pathname === "/v2/assets/AAPL") data = {
      symbol: "AAPL", status: "active", tradable: true, fractionable: true,
    };
    else if (url.pathname === "/v2/orders") data = changes.orders ?? [
      { id: "order-1", symbol: "AAPL", side: "buy", notional: "25", filled_qty: "0" },
    ];
    else if (url.pathname === "/v2/stocks/quotes/latest") data = {
      quotes: { AAPL: { ap: 100, t: changes.quoteTime ?? new Date().toISOString() } },
    };
    else if (url.pathname === "/v2/account/activities") {
      assert.equal(url.searchParams.get("activity_types"), "FILL");
      data = changes.fills ?? [{ id: "fill-1", activity_type: "FILL", side: "buy",
        price: "10", qty: "2", transaction_time: new Date().toISOString() }];
    } else throw new Error(`Unexpected request ${url}`);
    return Response.json(data);
  }) as typeof fetch;
}

test("reads account-bound Alpaca evidence and values open buys and fills", async () => {
  const snapshot = await new AlpacaBrokerReader(connection, fakeFetch()).readSnapshot("account-1", "AAPL");
  assert.equal(snapshot.source, "alpaca_connect");
  assert.ok(Number.isFinite(Date.parse(snapshot.quoteObservedAt)));
  assert.equal(snapshot.buyingPowerCents, 50_000);
  assert.equal(snapshot.portfolioValueCents, 100_000);
  assert.equal(snapshot.positionValueCents, 10_000);
  assert.equal(snapshot.openBuyOrdersTodayCents, 2_500);
  assert.equal(snapshot.executedBuysTodayCents, 2_000);
  assert.equal(snapshot.tradable, true);
});

test("rejects stale quotes and open buy exposure that cannot be valued", async () => {
  await assert.rejects(new AlpacaBrokerReader(connection, fakeFetch({
    quoteTime: new Date(Date.now() - 120_000).toISOString(),
  })).readSnapshot("account-1", "AAPL"), /stale/);
  await assert.rejects(new AlpacaBrokerReader(connection, fakeFetch({
    quoteTime: "invalid-time",
  })).readSnapshot("account-1", "AAPL"), /stale/);
  await assert.rejects(new AlpacaBrokerReader(connection, fakeFetch({
    quoteTime: new Date(Date.now() - 45_000).toISOString(),
  })).readSnapshot("account-1", "AAPL"), /stale/);
  await assert.rejects(new AlpacaBrokerReader(connection, fakeFetch({
    orders: [{ id: "order-2", symbol: "AAPL", side: "buy", qty: "1", notional: null }],
  })).readSnapshot("account-1", "AAPL"), /cannot be valued/);
});

test("rejects account mismatch before making a broker request", async () => {
  await assert.rejects(new AlpacaBrokerReader(connection, fakeFetch()).readSnapshot("other", "AAPL"), /mismatch/);
});

test("closed sessions explain the next opening without requesting a quote", async () => {
  const fetcher = fakeFetch({ marketOpen: false });
  let requests = 0;
  const clockOnly = (async (input, init) => {
    requests++;
    assert.equal(new URL(String(input)).pathname, "/v2/clock");
    return fetcher(input, init);
  }) as typeof fetch;
  await assert.rejects(new AlpacaBrokerReader(connection, clockOnly)
    .readSnapshot("account-1", "AAPL"), /market is closed.*Next regular session.*UTC.*No decision/);
  assert.equal(requests, 1);
});

test("stale market status cannot pass the session check", async () => {
  await assert.rejects(new AlpacaBrokerReader(connection, fakeFetch({
    clockTime: new Date(Date.now() - 120_000).toISOString(),
  })).readSnapshot("account-1", "AAPL"), /market status is unavailable or stale/);
});
