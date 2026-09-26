import { CHAIN, type ChainHolding, type ChainObservation } from "./robinhood-chain.ts";
import type { Mandate } from "./decision.ts";

const SCALE = 10n ** 18n;
export function parseUsdCents(value: string): number | null {
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents > 0n && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}
export function decimal18(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,30}(\.\d{1,18})?$/.test(value)) throw new Error("Invalid decimal evidence.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(18, "0"));
}
export type TokenPrice = {
  state: "fresh" | "stale" | "halted" | "unavailable";
  generatedAt: string | null; bid: string | null; ask: string | null;
  multiplier: string | null; tokenMid18: string | null; valueMicroUsd: string | null;
  reason: string;
};
export type PricedObservation = ChainObservation & {
  id: string; prices: Record<string, TokenPrice>; subtotalMicroUsd: string;
  valuationComplete: boolean; pricedCount: number; policyVersion: number | null;
  alerts: string[]; executionReady: false;
};
export function priceEvidence(holding: ChainHolding, body: unknown, now = Date.now()): TokenPrice {
  const empty: TokenPrice = { state: "unavailable", generatedAt: null, bid: null, ask: null,
    multiplier: holding.multiplier ?? null, tokenMid18: null, valueMicroUsd: null,
    reason: "A valid matching quote, multiplier and token decimals are required." };
  try {
    const quote = (body as { quotes?: {
      tokenSymbol: string; deployments: { chainId: number; contractAddress: string }[];
      bid: string; ask: string; currency: string; generatedAt: string; isTradingHalt: boolean;
    }[] })?.quotes?.find(q => q.tokenSymbol === holding.symbol && q.deployments?.some(d =>
      d.chainId === CHAIN.id && d.contractAddress.toLowerCase() === holding.contract.toLowerCase()));
    if (!quote || quote.currency !== "USD" || typeof quote.isTradingHalt !== "boolean" ||
      holding.decimals === null || holding.pendingMultiplier || holding.status !== "ASSET_STATUS_ACTIVE") return empty;
    const bid = decimal18(quote.bid), ask = decimal18(quote.ask), multiplier = decimal18(holding.multiplier);
    if (bid <= 0n || ask < bid || multiplier <= 0n) return empty;
    const timestamp = Date.parse(quote.generatedAt);
    const evidence = { ...empty, generatedAt: Number.isFinite(timestamp) ? quote.generatedAt : null,
      bid: quote.bid, ask: quote.ask };
    if (quote.isTradingHalt) return { ...evidence, state: "halted", reason: "Official quote reports a trading halt; excluded from valuation." };
    if (!Number.isFinite(timestamp) || now - timestamp > 120_000 || timestamp - now > 10_000)
      return { ...evidence, state: "stale", reason: "Quote is older than two minutes or its timestamp is invalid; excluded from valuation." };
    const mid = ((bid + ask) * multiplier) / (2n * SCALE);
    const value = (BigInt(holding.raw) * mid * 1_000_000n) / ((10n ** BigInt(holding.decimals)) * SCALE);
    return { ...evidence, state: "fresh", tokenMid18: mid.toString(), valueMicroUsd: value.toString(),
      reason: "Indicative midpoint × official shares-per-token multiplier × raw token quantity. Not a swap quote or executable price." };
  } catch { return empty; }
}

export async function enrichObservation(observation: ChainObservation, mandate: Mandate | null,
  fetcher: typeof fetch = fetch): Promise<PricedObservation> {
  const prices: Record<string, TokenPrice> = {};
  // Bound provider load. Beyond this limit balances remain visible, explicitly unpriced.
  for (let start = 0; start < Math.min(observation.holdings.length, 20); start += 4) {
    await Promise.all(observation.holdings.slice(start, Math.min(start + 4, 20)).map(async holding => {
      let body: unknown = null;
      try {
        const response = await fetcher(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(holding.symbol)}`,
          { cache: "no-store", signal: AbortSignal.timeout(8000) });
        if (response.ok) body = await response.json();
      } catch { /* A price outage must not erase a valid balance observation. */ }
      prices[holding.contract] = priceEvidence(holding, body);
    }));
  }
  for (const holding of observation.holdings) prices[holding.contract] ??= priceEvidence(holding, null);
  const valid = Object.values(prices).filter(p => p.valueMicroUsd !== null);
  const subtotal = valid.reduce((sum, p) => sum + BigInt(p.valueMicroUsd!), 0n);
  const complete = observation.failures === 0 && valid.length === observation.holdings.length;
  const alerts = ["Values cover supported stock tokens only; ETH, other tokens, DeFi and other chains are excluded."];
  if (!complete) alerts.push("Coverage or prices are incomplete. Subtotal is not total portfolio value; concentration conclusions are pending.");
  if (mandate) {
    for (const holding of observation.holdings) {
      if (!mandate.allowedSymbols.includes(holding.symbol)) alerts.push(`${holding.symbol} is outside your purchase allowlist. Holding it is not an instruction to sell.`);
    }
  } else alerts.push("Save a mandate to check purchase-symbol and size boundaries.");
  alerts.push("Full-wallet concentration, daily spending, available settlement funds and execution eligibility are not established by this scan.");
  return { ...observation, id: crypto.randomUUID(), prices, subtotalMicroUsd: subtotal.toString(),
    valuationComplete: complete, pricedCount: valid.length, policyVersion: mandate?.version ?? null,
    alerts, executionReady: false };
}

export type Preview = { amountCents: number; checks: { label: string; state: "pass" | "fail" | "pending"; detail: string }[] };
export function purchasePreview(record: PricedObservation, contract: string, amountCents: number, mandate: Mandate): Preview {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("Enter a positive dollar amount.");
  const holding = record.holdings.find(h => h.contract === contract);
  if (!holding) throw new Error("Select an observed stock token.");
  const fresh = Date.now() - Date.parse(record.observedAt) <= 120_000 && Date.now() >= Date.parse(record.observedAt);
  return { amountCents, checks: [
    { label: "Approved purchase symbol", state: mandate.allowedSymbols.includes(holding.symbol) ? "pass" : "fail", detail: `${holding.symbol}; saved mandate v${mandate.version}.` },
    { label: "Single purchase limit", state: amountCents <= mandate.maxOrderCents ? "pass" : "fail", detail: `Maximum $${(mandate.maxOrderCents / 100).toFixed(2)}.` },
    { label: "Daily purchase limit", state: amountCents > mandate.maxDailyBuyCents ? "fail" : "pending", detail: "A proposal above the daily cap fails; otherwise today's executed buys and pending transactions must be reconciled." },
    { label: "Indicative price evidence", state: fresh && record.prices[contract]?.state === "fresh" && Date.now() - Date.parse(record.prices[contract]?.generatedAt ?? "") <= 120_000 ? "pass" : "pending", detail: "An indicative price is not an executable swap quote." },
    { label: "Full-wallet concentration", state: "pending", detail: `Ceiling ${mandate.maxPositionBps / 100}%. Stock-token subtotal excludes other wallet assets; the full denominator is unknown.` },
    { label: "Funds, eligibility and swap route", state: "pending", detail: "Settlement-token balance, allowance, liquidity, slippage, fees and user eligibility must be checked before execution. This preview sends no transaction." },
  ] };
}

export function compareObservations(current: PricedObservation, previous: PricedObservation): string[] {
  if (current.address !== previous.address || current.chainId !== previous.chainId) return ["Comparison needs the same address and network."];
  if (current.failures || previous.failures) return ["Balance comparison is pending because a scan was incomplete."];
  const contracts = new Set([...current.holdings, ...previous.holdings].map(h => h.contract));
  const changes: string[] = [];
  for (const contract of contracts) {
    const next = current.holdings.find(h => h.contract === contract), old = previous.holdings.find(h => h.contract === contract);
    const symbol = next?.symbol ?? old!.symbol;
    if ((next?.raw ?? "0x0") !== (old?.raw ?? "0x0")) changes.push(`${symbol}: token quantity changed. Transaction cause is not yet reconciled.`);
    else if (next?.multiplier !== old?.multiplier) changes.push(`${symbol}: raw balance unchanged; the official corporate-action multiplier changed.`);
    else if (current.prices[contract]?.tokenMid18 && previous.prices[contract]?.tokenMid18 && current.prices[contract].tokenMid18 !== previous.prices[contract].tokenMid18)
      changes.push(`${symbol}: quantity unchanged; the indicative midpoint changed. This is not realized profit.`);
  }
  if (current.policyVersion !== previous.policyVersion) changes.push("The saved mandate version changed between observations.");
  return changes.length ? changes : ["No quantity, multiplier, available midpoint or mandate-version changes were detected in the covered assets."];
}
