export const DEFAULT_EARLY_CONFIRMATIONS = 12;

export function earlyConfirmationCount(value: unknown = typeof process === 'undefined' ? undefined : process.env.EARLY_CONFIRMATION_BLOCKS): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : DEFAULT_EARLY_CONFIRMATIONS;
  return Number.isSafeInteger(parsed) && parsed >= 2 && parsed <= 120 ? parsed : DEFAULT_EARLY_CONFIRMATIONS;
}

export function hasEarlyConfirmations(head: unknown, included: unknown, count = earlyConfirmationCount()): boolean {
  try {
    if (typeof head !== 'string' || typeof included !== 'string' || !/^0x[\da-f]+$/i.test(head) || !/^0x[\da-f]+$/i.test(included)) return false;
    return BigInt(head) >= BigInt(included) + BigInt(count) - 1n;
  } catch { return false; }
}
