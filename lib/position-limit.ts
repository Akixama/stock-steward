// "Max in one stock" for manual buys. Uses the latest saved value check of the Steward
// wallet and counts against the buyer: the stock being bought at its ask, everything else
// at its bid, and the total reduced by the swap's slippage allowance. Anything missing or
// out of date refuses the buy instead of passing it.
import type { PricedObservation } from './chain-analysis.ts';

export const POSITION_CHECK_MAX_AGE_MS = 15 * 60_000;
const SLIPPAGE_BPS = 50n;

export type PositionLimitInput = {
  observation: PricedObservation | null;
  safe: string;
  symbol: string;
  buyCents: number;
  maxPositionBps: number;
  /** $ of this stock bought (pending or confirmed) after the value check was saved. */
  buysSinceCents: number;
  /** A sale or send after the value check means the saved total may be too high. */
  outflowSinceCheck: boolean;
  now?: number;
};
export type PositionLimitResult =
  | { ok: true; shareBps: number; heldCents: number; totalCents: number; allowedCents: number }
  | { ok: false; reason: 'stale' | 'over'; error: string; shareBps?: number; heldCents?: number; totalCents?: number; allowedCents?: number };

const STALE = 'Open Home to refresh your wallet value, then try again. Nothing was sent.';
const money = (micro: bigint) => `$${(Number(micro / 10_000n) / 100).toFixed(2)}`;

// Parses a positive decimal like "524.12" into micro-units, or null.
function micro(value: string | null | undefined): bigint | null {
  if (typeof value !== 'string' || !/^\d{1,12}(\.\d{1,18})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const parsed = BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
  return parsed > 0n ? parsed : null;
}

export function positionLimitCheck(input: PositionLimitInput): PositionLimitResult {
  const now = input.now ?? Date.now();
  const { observation: record } = input;
  if (!Number.isInteger(input.maxPositionBps) || input.maxPositionBps < 1 || input.maxPositionBps > 10_000) return { ok: false, reason: 'stale', error: STALE };
  if (!Number.isSafeInteger(input.buyCents) || input.buyCents < 1 || !Number.isSafeInteger(input.buysSinceCents) || input.buysSinceCents < 0) return { ok: false, reason: 'stale', error: STALE };
  if (!record || record.address.toLowerCase() !== input.safe.toLowerCase() || input.outflowSinceCheck) return { ok: false, reason: 'stale', error: STALE };
  const at = Date.parse(record.observedAt);
  if (!Number.isFinite(at) || at > now || now - at > POSITION_CHECK_MAX_AGE_MS) return { ok: false, reason: 'stale', error: STALE };
  if (!record.valuationComplete || record.failures !== 0 || record.usdg === null) return { ok: false, reason: 'stale', error: STALE };
  const usdg = record.usdg === '0' ? 0n : micro(record.usdg);
  if (usdg === null) return { ok: false, reason: 'stale', error: STALE };

  let others = 0n, held = 0n, heldLower = 0n;
  for (const holding of record.holdings) {
    if (holding.quantity === null) return { ok: false, reason: 'stale', error: STALE };
    if (Number(holding.quantity) === 0) continue;
    const price = record.prices[holding.contract];
    const value = price?.valueMicroUsd ? BigInt(price.valueMicroUsd) : null;
    const bid = micro(price?.bid), ask = micro(price?.ask);
    if (value === null || bid === null || ask === null || ask < bid) return { ok: false, reason: 'stale', error: STALE };
    const mid2 = bid + ask; // value is priced at the midpoint; rescale to bid or ask.
    if (holding.symbol === input.symbol) { held += (value * 2n * ask + mid2 - 1n) / mid2; heldLower += (value * 2n * bid) / mid2; }
    else others += (value * 2n * bid) / mid2;
  }
  // Buying converts USDG into stock, so the total stays the same apart from slippage.
  const buy = BigInt(input.buyCents) * 10_000n;
  const total = usdg + others + heldLower - (buy * SLIPPAGE_BPS + 9_999n) / 10_000n;
  const position = held + BigInt(input.buysSinceCents) * 10_000n + buy;
  const maxBps = BigInt(input.maxPositionBps);
  const shareBps = total > 0n ? Number((position * 10_000n + total - 1n) / total) : 10_000;
  const allowed = total > 0n ? (total * maxBps) / 10_000n : 0n;
  const numbers = { shareBps, heldCents: Number((held + BigInt(input.buysSinceCents) * 10_000n) / 10_000n), totalCents: Number((total > 0n ? total : 0n) / 10_000n), allowedCents: Number(allowed / 10_000n) };
  if (total <= 0n || position * 10_000n > total * maxBps) {
    return { ok: false, reason: 'over', error: `This buy would put ${(shareBps / 100).toFixed(1)}% of your Steward wallet in ${input.symbol}. Your limit is ${(input.maxPositionBps / 100).toFixed(2)}%, so you can hold up to ${money(allowed)} of ${input.symbol}. Nothing was sent.`, ...numbers };
  }
  return { ok: true, ...numbers };
}

