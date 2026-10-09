import type { AlpacaConnection } from "./alpaca-connection.ts";
import type { Mandate, ProposedBuy } from "./decision.ts";
import { alpacaGet } from "./alpaca-http.ts";

export type AccountView = {
  observedAt: string; environment: "live" | "paper"; accountStatus: string;
  equityCents: number; cashCents: number; availableCashCents: number;
  marketOpen: boolean; nextOpen: string;
  positions: { symbol: string; valueCents: number }[];
  orders: { symbol: string; side: string; status: string; notionalCents: number | null }[];
  ordersComplete: boolean;
};
export type Observation = {
  id: string; kind: "observation"; createdAt: string; policyVersion: number;
  proposal: ProposedBuy; account: AccountView;
  checks: { rule: string; state: "pass" | "fail" | "pending"; detail: string }[];
  why: string; retryAt: string; executionReady: false;
};
function money(value: unknown, signed = false): number {
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "string" && value.trim() === "")) throw new Error("Account amount is missing.");
  const n = Number(value), result = Math.round(n * 100);
  if (!Number.isFinite(n) || !Number.isSafeInteger(result) || (!signed && result < 0)) throw new Error("Account amount is invalid.");
  return result;
}
export async function readAccountView(connection: AlpacaConnection, fetcher: typeof fetch = fetch): Promise<AccountView> {
  const get = <T>(path: string) => alpacaGet<T>(connection.environment, connection.token, path, fetcher);
  const [account, positions, orders, clock] = await Promise.all([
    get<{ id: string; status: string; equity: string; cash: string; buying_power: string }>("/v2/account"),
    get<{ symbol: string; market_value: string }[]>("/v2/positions"),
    get<{ symbol: string; side: string; status: string; notional?: string | null }[]>("/v2/orders?status=open&limit=500"),
    get<{ is_open: boolean; timestamp: string; next_open: string }>("/v2/clock"),
  ]);
  if (account.id !== connection.accountRef || !account.status || !Array.isArray(positions) || !Array.isArray(orders) ||
    typeof clock.is_open !== "boolean" || !Number.isFinite(Date.parse(clock.timestamp)) ||
    Math.abs(Date.now() - Date.parse(clock.timestamp)) > 30_000 || !Number.isFinite(Date.parse(clock.next_open))) {
    throw new Error("Account observation is incomplete or market status is stale. No record saved.");
  }
  const cashCents = money(account.cash, true);
  return { observedAt: new Date().toISOString(), environment: connection.environment,
    accountStatus: account.status, equityCents: money(account.equity, true), cashCents,
    availableCashCents: Math.max(0, Math.min(cashCents, money(account.buying_power))),
    marketOpen: clock.is_open, nextOpen: clock.next_open, ordersComplete: orders.length < 500,
    positions: positions.map(p => { if (!p.symbol) throw new Error("Position symbol missing."); return { symbol: p.symbol, valueCents: money(p.market_value, true) }; }),
    orders: orders.map(o => { if (!o.symbol || !o.side || !o.status) throw new Error("Order evidence incomplete."); return {
      symbol: o.symbol, side: o.side, status: o.status, notionalCents: o.notional == null ? null : money(o.notional),
    }; }),
  };
}

/** A partial observation can never be approved or submitted as an order. */
export function observeClosedBuy(mandate: Mandate, account: AccountView, proposal: ProposedBuy): Observation {
  if (account.marketOpen || !Number.isFinite(Date.parse(account.observedAt)) ||
    Math.abs(Date.now() - Date.parse(account.observedAt)) > 60_000 || mandate.version < 1 ||
    !Number.isSafeInteger(proposal.amountCents) || proposal.amountCents <= 0 || !/^[A-Z.]{1,8}$/.test(proposal.symbol)) {
    throw new Error("A closed-session observation needs a saved mandate and fresh account evidence.");
  }
  const checks: Observation["checks"] = [
    { rule: "Approved symbol", state: mandate.allowedSymbols.includes(proposal.symbol) ? "pass" : "fail", detail: `${proposal.symbol}; allowed: ${mandate.allowedSymbols.join(", ") || "none"}.` },
    { rule: "Single purchase limit", state: proposal.amountCents <= mandate.maxOrderCents ? "pass" : "fail", detail: `Proposed $${(proposal.amountCents / 100).toFixed(2)}; maximum $${(mandate.maxOrderCents / 100).toFixed(2)}.` },
    { rule: "Available funds", state: proposal.amountCents <= account.availableCashCents ? "pass" : "fail", detail: `$${(account.availableCashCents / 100).toFixed(2)} available in the broker response; cash and buying power minimum, without margin. Must be rechecked before any order.` },
    { rule: "Account eligibility", state: account.accountStatus === "ACTIVE" ? "pending" : "fail", detail: `Broker status: ${account.accountStatus}. Trading restrictions and stock eligibility need a fresh full check.` },
    { rule: "Daily purchase limit", state: proposal.amountCents > mandate.maxDailyBuyCents ? "fail" : "pending", detail: `Maximum $${(mandate.maxDailyBuyCents / 100).toFixed(2)}. Filled buys and remaining open-buy exposure must be reconciled for the execution day.` },
    { rule: "Position concentration", state: "pending", detail: `Maximum ${(mandate.maxPositionBps / 100).toFixed(2)}%. Broker valuations may reflect the last session; allocation must be rechecked with fresh evidence.` },
    { rule: "Fresh quote and market session", state: "pending", detail: "Regular session closed. No current execution quote was used." },
  ];
  return { id: crypto.randomUUID(), kind: "observation", createdAt: new Date().toISOString(),
    policyVersion: mandate.version, proposal: { ...proposal }, account, checks, executionReady: false,
    why: checks.some(c => c.state === "fail") ? "Known limits prevent this proposal; other checks remain pending. No order was sent." : "Partial checks recorded. Market-dependent checks remain pending. This is not approval to trade.",
    retryAt: account.nextOpen };
}
