// "Would this buy fit my limits?" for the Buy flow. Pure and advisory: it
// prepares, signs and sends nothing. Order checks still run on the server.
export type LimitsCheckLine = { label: string; ok: boolean; detail: string };
type Limits = { allowedSymbols: string[]; maxOrderCents: number; maxDailyBuyCents: number; version: number };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function limitsCheck(limits: Limits, symbol: string, amountCents: number, spentTodayCents?: number): { fits: boolean; lines: LimitsCheckLine[] } {
  if (!limits.version) return { fits: false, lines: [{ label: 'Limits', ok: false, detail: 'Save your limits first.' }] };
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) return { fits: false, lines: [{ label: 'Amount', ok: false, detail: 'Enter an amount above $0.00.' }] };
  const left = Math.max(0, limits.maxDailyBuyCents - Math.max(0, spentTodayCents ?? 0));
  const lines: LimitsCheckLine[] = [
    { label: 'Stock', ok: limits.allowedSymbols.includes(symbol), detail: limits.allowedSymbols.includes(symbol) ? `${symbol} is in your Limits.` : `${symbol} is not in your Limits.` },
    { label: 'Per buy', ok: amountCents <= limits.maxOrderCents, detail: `${money(amountCents)} of ${money(limits.maxOrderCents)} allowed per buy.` },
    { label: 'Per day', ok: amountCents <= left, detail: spentTodayCents === undefined ? `Up to ${money(limits.maxDailyBuyCents)} per day. Earlier buys today also count.` : `${money(left)} left today.` },
  ];
  return { fits: lines.every(line => line.ok), lines };
}

export function parseDollars(value: string): number {
  return /^\d+(\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value) * 100) : NaN;
}
