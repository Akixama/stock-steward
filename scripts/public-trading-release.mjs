export function publicTradingVars(release) {
  if (typeof release !== 'object' || release === null || typeof release.enabled !== 'boolean') {
    throw new Error('Invalid public trading release configuration.');
  }
  const validCap = (value) => Number.isSafeInteger(value) && value > 0 && value <= 1_000_000;
  if (!validCap(release.maxOrderCents) || !validCap(release.maxDailyCents) || release.maxDailyCents < release.maxOrderCents) {
    throw new Error('Invalid public trading release caps.');
  }
  return {
    PUBLIC_MODE: String(release.enabled),
    STEWARD_PUBLIC_MAX_ORDER_CENTS: String(release.maxOrderCents),
    STEWARD_PUBLIC_MAX_DAILY_CENTS: String(release.maxDailyCents),
  };
}
