import type { AlpacaConnection } from "./alpaca-connection.ts";
import { alpacaBase } from "./alpaca-http.ts";
import type { ApprovalPlan, AlpacaBuyOrder } from "./approval-plan.ts";

export type AlpacaOrderStatus = "accepted" | "pending_new" | "new" | "partially_filled" |
  "filled" | "canceled" | "expired" | "rejected" | "done_for_day" | "pending_cancel" |
  "pending_replace" | "replaced" | "stopped" | "suspended" | "calculated" |
  "accepted_for_bidding";

export type BrokerOrder = {
  id: string;
  clientOrderId: string;
  symbol: string;
  notionalCents: number;
  status: AlpacaOrderStatus;
  filledCents: number;
};

type RawOrder = {
  id?: unknown; client_order_id?: unknown; symbol?: unknown; notional?: unknown;
  side?: unknown; type?: unknown; time_in_force?: unknown; status?: unknown;
  filled_qty?: unknown; filled_avg_price?: unknown;
};

const statuses = new Set<AlpacaOrderStatus>([
  "accepted", "pending_new", "new", "partially_filled", "filled", "canceled",
  "expired", "rejected", "done_for_day", "pending_cancel", "pending_replace",
  "replaced", "stopped", "suspended", "calculated", "accepted_for_bidding",
]);

function moneyCents(value: unknown): number {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,9})?$/.test(value)) {
    throw new Error("Broker order amount is invalid.");
  }
  const [whole, fraction = ""] = value.split(".");
  if (/[^0]/.test(fraction.slice(2))) throw new Error("Broker order amount is invalid.");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new Error("Broker order amount is invalid.");
  return cents;
}

function parseOrder(raw: RawOrder, plan: ApprovalPlan): BrokerOrder {
  if (typeof raw.id !== "string" || !raw.id ||
    raw.client_order_id !== plan.order.client_order_id || raw.symbol !== plan.order.symbol ||
    raw.side !== "buy" || raw.type !== "market" || raw.time_in_force !== "day" ||
    typeof raw.status !== "string" || !statuses.has(raw.status as AlpacaOrderStatus) ||
    moneyCents(raw.notional) !== moneyCents(plan.order.notional)) {
    throw new Error("Broker order does not match the authorized order.");
  }
  let filledCents = 0;
  const quantity = raw.filled_qty == null ? 0 : Number(raw.filled_qty);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error("Broker fill amount is invalid.");
  if (quantity > 0) {
    const averagePrice = Number(raw.filled_avg_price);
    filledCents = Math.round(quantity * averagePrice * 100);
    if (!Number.isFinite(quantity) || !Number.isFinite(averagePrice) ||
      !Number.isSafeInteger(filledCents) || filledCents <= 0) {
      throw new Error("Broker fill amount is invalid.");
    }
  }
  if ((raw.status === "filled" || raw.status === "partially_filled") && filledCents === 0) {
    throw new Error("Broker fill amount is missing.");
  }
  return { id: raw.id, clientOrderId: raw.client_order_id as string,
    symbol: raw.symbol as string, notionalCents: moneyCents(raw.notional),
    status: raw.status as AlpacaOrderStatus, filledCents };
}

/** The caller must enforce owner identity, trading scope, and the deployment switch. */
export class AlpacaOrderGateway {
  private readonly connection: AlpacaConnection;
  private readonly fetcher: typeof fetch;
  constructor(connection: AlpacaConnection, fetcher: typeof fetch = fetch) {
    this.connection = connection;
    this.fetcher = fetcher;
  }

  async submit(plan: ApprovalPlan): Promise<BrokerOrder> {
    if (this.connection.accountRef !== plan.accountRef) throw new Error("Broker account changed.");
    const response = await this.fetcher(`${alpacaBase(this.connection.environment)}/v2/orders`, {
      method: "POST", headers: { Authorization: `Bearer ${this.connection.token}`,
        Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(plan.order satisfies AlpacaBuyOrder), cache: "no-store",
    });
    // Even an error response can be ambiguous. Never retry POST automatically.
    if (!response.ok) throw new Error(`Broker order response was ${response.status}; reconcile by client order ID.`);
    return parseOrder(await response.json() as RawOrder, plan);
  }

  async findByClientOrderId(plan: ApprovalPlan): Promise<BrokerOrder | null> {
    if (this.connection.accountRef !== plan.accountRef) throw new Error("Broker account changed.");
    const query = new URLSearchParams({ client_order_id: plan.order.client_order_id });
    const response = await this.fetcher(`${alpacaBase(this.connection.environment)}/v2/orders:by_client_order_id?${query}`, {
      headers: { Authorization: `Bearer ${this.connection.token}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Broker order lookup failed (${response.status}).`);
    return parseOrder(await response.json() as RawOrder, plan);
  }
}
