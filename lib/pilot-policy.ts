// Stage 1 of real assisted investing: the pilot caps, locked in code. Activation
// refuses any mandate above these numbers or without approval on every order.
// $10 per trade, $50 per day, $100 total across the 2-day policy window.

export const PILOT_MAX_ORDER_CENTS = 1_000;
export const PILOT_MAX_DAILY_CENTS = 5_000;

export type PilotMandate = {
  maxOrderCents: number;
  maxDailyBuyCents: number;
  requireApproval: boolean;
  executionPreference?: "approval" | "automatic" | undefined;
};

export function validatePilotMandate(mandate: PilotMandate | null, limits = { maxOrderCents: PILOT_MAX_ORDER_CENTS, maxDailyCents: PILOT_MAX_DAILY_CENTS }): { ok: true } | { ok: false; error: string } {
  if (!mandate) return { ok: false, error: "Save your limits in Mandate first." };
  if (mandate.executionPreference !== "approval" || mandate.requireApproval !== true) {
    return { ok: false, error: "Real-money buying needs approval on every order. Turn off automatic mode first." };
  }
  if (!Number.isSafeInteger(mandate.maxOrderCents) || !Number.isSafeInteger(mandate.maxDailyBuyCents)) {
    return { ok: false, error: "Your saved limits are inconsistent; review Mandate." };
  }
  if (mandate.maxOrderCents < 1 || mandate.maxOrderCents > limits.maxOrderCents) {
    return { ok: false, error: `Set your single-trade limit at or below $${(limits.maxOrderCents / 100).toFixed(2)}.` };
  }
  if (mandate.maxDailyBuyCents < mandate.maxOrderCents || mandate.maxDailyBuyCents > limits.maxDailyCents) {
    return { ok: false, error: `Set your daily limit at or below $${(limits.maxDailyCents / 100).toFixed(2)}.` };
  }
  return { ok: true };
}
