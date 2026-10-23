export function publicTradingVars(release) {
  if (typeof release !== 'object' || release === null || typeof release.enabled !== 'boolean') {
    throw new Error('Invalid public trading release configuration.');
  }
  const validCap = (value) => Number.isSafeInteger(value) && value > 0 && value <= 100_000_000;
  if (!validCap(release.maxOrderCents) || !validCap(release.maxDailyCents) || release.maxDailyCents < release.maxOrderCents) {
    throw new Error('Invalid public trading release caps.');
  }
  if (!validCap(release.maxEditableLimitCents)) throw new Error('Invalid editable Limits ceiling.');
  if (typeof release.usIpBlockEnabled !== 'boolean') throw new Error('Invalid US IP block configuration.');
  return {
    PUBLIC_MODE: String(release.enabled),
    STEWARD_PUBLIC_MAX_ORDER_CENTS: String(release.maxOrderCents),
    STEWARD_PUBLIC_MAX_DAILY_CENTS: String(release.maxDailyCents),
    STEWARD_MAX_EDITABLE_LIMIT_CENTS: String(release.maxEditableLimitCents),
    STEWARD_US_IP_BLOCK_ENABLED: String(release.usIpBlockEnabled),
  };
}
