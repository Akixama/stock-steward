import release from '../config/public-trading-release.json' with { type: 'json' };
import type { Mandate } from './decision.ts';

// One release value governs both the browser editor and the authenticated save route.
export const MAX_EDITABLE_LIMIT_CENTS = release.maxEditableLimitCents;
export const NEW_USER_MANDATE: Mandate = {
  version: 0, allowedSymbols: [], maxOrderCents: 10_000,
  maxDailyBuyCents: 25_000, maxPositionBps: 1_500,
  requireApproval: true, executionPreference: 'approval',
};

export function editableLimitsValid(orderCents: number, dailyCents: number): boolean {
  return Number.isSafeInteger(orderCents) && orderCents >= 1 && orderCents <= MAX_EDITABLE_LIMIT_CENTS &&
    Number.isSafeInteger(dailyCents) && dailyCents >= orderCents && dailyCents <= MAX_EDITABLE_LIMIT_CENTS;
}
