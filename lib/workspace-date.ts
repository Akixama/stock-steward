const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
};

/** Dates from APIs and wallets must never be able to crash a workspace render. */
export function formatWorkspaceDate(
  value: unknown,
  options: Intl.DateTimeFormatOptions = DEFAULT_OPTIONS,
  unit: 'milliseconds' | 'seconds' = 'milliseconds',
): string {
  try {
    if (value === null || value === undefined || value === '') return 'Date unavailable';
    const source = typeof value === 'number' && unit === 'seconds' ? value * 1000 : value;
    const date = value instanceof Date ? value : new Date(source as string | number);
    if (!Number.isFinite(date.getTime())) return 'Date unavailable';
    try {
      return new Intl.DateTimeFormat(undefined, options).format(date);
    } catch {
      return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    }
  } catch {
    return 'Date unavailable';
  }
}
