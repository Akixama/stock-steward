import type { BrokerReader } from "./broker-boundary.ts";
import type { BrokerSnapshot } from "./decision.ts";
import type { AlpacaConnection } from "./alpaca-connection.ts";
import { alpacaGet } from "./alpaca-http.ts";

type Account = { id?: string; equity?: string; cash?: string; buying_power?: string;
  status?: string; trading_blocked?: boolean };
type Position = { symbol?: string; market_value?: string };
type Asset = { symbol?: string; tradable?: boolean; fractionable?: boolean; status?: string };
type Order = { id?: string; symbol?: string; side?: string; notional?: string | null;
  qty?: string | null; filled_qty?: string | null; status?: string };
type Fill = { id?: string; activity_type?: string; side?: string; price?: string; qty?: string;
  transaction_time?: string };
type Quote = { ap?: number; t?: string };
type MarketClock = { is_open?: boolean; timestamp?: string; next_open?: string };

function cents(value: string | number | undefined | null): number {
  if (typeof value !== "string" && typeof value !== "number") throw new Error("Broker amount is missing.");
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Broker amount is invalid.");
  const result = Math.ceil(amount * 100 - 1e-8);
  if (!Number.isSafeInteger(result)) throw new Error("Broker amount exceeds safe limits.");
  return result;
}

function requiredArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw new Error("Broker response is incomplete.");
  return value as T[];
}

/** Read-only Alpaca Connect adapter. Any incomplete input fails before a receipt is saved. */
export class AlpacaBrokerReader implements BrokerReader {
  readonly source = "alpaca_connect";
  private readonly connection: AlpacaConnection;
  private readonly fetcher: typeof fetch;
  constructor(connection: AlpacaConnection, fetcher: typeof fetch = fetch) {
    this.connection = connection;
    this.fetcher = fetcher;
  }

  async readSnapshot(accountRef: string, symbol: string): Promise<BrokerSnapshot> {
    if (accountRef !== this.connection.accountRef || !/^[A-Z.]{1,8}$/.test(symbol)) {
      throw new Error("Broker account or stock mismatch. No decision was made.");
    }
    const { environment, token } = this.connection;
    const clock = await alpacaGet<MarketClock>(environment, token, "/v2/clock", this.fetcher);
    const clockAt = Date.parse(clock.timestamp ?? "");
    if (typeof clock.is_open !== "boolean" || !Number.isFinite(clockAt) ||
      Math.abs(Date.now() - clockAt) > 30_000) {
      throw new Error("Alpaca market status is unavailable or stale. No decision was made.");
    }
    if (!clock.is_open) {
      const nextOpen = Date.parse(clock.next_open ?? "");
      const next = Number.isFinite(nextOpen) && nextOpen > clockAt
        ? ` Next regular session: ${new Intl.DateTimeFormat("en-GB", {
          timeZone: "UTC", dateStyle: "medium", timeStyle: "short",
        }).format(nextOpen)} (UTC).` : "";
      throw new Error(`The US stock market is closed.${next} Check again during the regular session. No decision was made and no order was sent.`);
    }
    const [account, rawPositions, asset, rawOrders, rawQuote] = await Promise.all([
      alpacaGet<Account>(environment, token, "/v2/account", this.fetcher),
      alpacaGet<Position[]>(environment, token, "/v2/positions", this.fetcher),
      alpacaGet<Asset>(environment, token, `/v2/assets/${encodeURIComponent(symbol)}`, this.fetcher),
      alpacaGet<Order[]>(environment, token, "/v2/orders?status=open&limit=500", this.fetcher),
      this.latestQuote(symbol),
    ]);
    if (account.id !== accountRef || account.status !== "ACTIVE" || account.trading_blocked !== false ||
      asset.symbol !== symbol || asset.status !== "active") {
      throw new Error("Alpaca account or asset is unavailable. No decision was made.");
    }
    const positions = requiredArray<Position>(rawPositions);
    const orders = requiredArray<Order>(rawOrders);
    if (orders.length >= 500) throw new Error("Open order list may be incomplete. No decision was made.");
    if (typeof rawQuote.ap !== "number" || !Number.isFinite(rawQuote.ap) || rawQuote.ap <= 0) {
      throw new Error("Alpaca returned no usable IEX ask quote. No decision was made.");
    }
    const quoteCents = cents(rawQuote.ap);
    const quoteAt = Date.parse(rawQuote.t ?? "");
    if (!Number.isFinite(quoteAt) || quoteCents === 0 ||
      Date.now() - quoteAt > 30_000 || quoteAt - Date.now() > 5_000) {
      throw new Error("Alpaca quote is stale or unavailable. No decision was made.");
    }
    const position = positions.find((item) => item.symbol === symbol);
    const positionValueCents = position ? cents(position.market_value) : 0;
    const portfolioValueCents = cents(account.equity);
    // Use the lesser of cash and buying power so a mandate cannot silently use margin.
    const buyingPowerCents = Math.min(cents(account.cash), cents(account.buying_power));
    let openBuyOrdersTodayCents = 0;
    let openBuyOrdersForSymbolCents = 0;
    for (const order of orders) {
      if (order.side !== "buy") continue;
      // Quantity orders and partial fills need a broker-confirmed remaining notional.
      // Guessing their value could understate exposure, so fail closed.
      if (!order.id || !order.symbol || order.notional == null ||
        (order.filled_qty != null && Number(order.filled_qty) > 0)) {
        throw new Error("Open buy exposure cannot be valued safely. No decision was made.");
      }
      const amount = cents(order.notional);
      openBuyOrdersTodayCents += amount;
      if (order.symbol === symbol) openBuyOrdersForSymbolCents += amount;
    }
    const executedBuysTodayCents = await this.todayBuyFills();
    if (Date.now() - quoteAt > 30_000) {
      throw new Error("Alpaca quote expired during the account read. No decision was made.");
    }
    const snapshot: BrokerSnapshot = {
      source: this.source, observedAt: new Date().toISOString(), accountRef, symbol, quoteCents,
      quoteObservedAt: rawQuote.t!,
      positionValueCents, portfolioValueCents, buyingPowerCents, executedBuysTodayCents,
      openBuyOrdersTodayCents, openBuyOrdersForSymbolCents,
      tradable: asset.tradable === true && asset.fractionable === true,
    };
    return snapshot;
  }

  private async latestQuote(symbol: string): Promise<Quote> {
    const response = await this.fetcher(`https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=${encodeURIComponent(symbol)}&feed=iex`, {
      headers: { Authorization: `Bearer ${this.connection.token}`, Accept: "application/json" }, cache: "no-store",
    });
    if (!response.ok) throw new Error(`Alpaca market data request failed (${response.status}). No decision was made.`);
    const data = await response.json() as { quotes?: Record<string, Quote> };
    return data.quotes?.[symbol] ?? {};
  }

  private async todayBuyFills(): Promise<number> {
    // The mandate's day is UTC. Page through every fill rather than trusting a default limit.
    const date = new Date().toISOString().slice(0, 10);
    let pageToken: string | null = null;
    let total = 0;
    for (let page = 0; page < 20; page++) {
      const query = new URLSearchParams({ activity_types: "FILL", date, direction: "asc", page_size: "100" });
      if (pageToken) query.set("page_token", pageToken);
      const fills = requiredArray<Fill>(await alpacaGet<Fill[]>(this.connection.environment,
        this.connection.token, `/v2/account/activities?${query}`, this.fetcher));
      for (const fill of fills) {
        if (fill.side === "buy") {
          if (fill.activity_type !== "FILL" || !fill.transaction_time || !fill.price || !fill.qty) {
            throw new Error("Alpaca fill record is incomplete. No decision was made.");
          }
          total += cents(Number(fill.price) * Number(fill.qty));
        }
      }
      if (fills.length < 100) return total;
      pageToken = fills.at(-1)?.id ?? null;
      if (!pageToken) break;
    }
    throw new Error("Alpaca fill history may be incomplete. No decision was made.");
  }
}
