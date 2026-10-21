export function portfolioValue(cashMicro: bigint | null, stockHoldings: number, stockSubtotalMicro: bigint | null): bigint | null {
  if (cashMicro === null) return null;
  if (stockHoldings === 0) return cashMicro;
  return stockSubtotalMicro === null ? null : cashMicro + stockSubtotalMicro;
}

// Presentation only: a known cash balance can still be shown when some stock
// prices are missing. Callers must label this as partial, never as a full total.
export function visiblePortfolioValue(cashMicro: bigint | null, pricedStockMicro: bigint | null): bigint | null {
  return cashMicro === null ? null : cashMicro + (pricedStockMicro ?? 0n);
}

export function walletBalanceFingerprint(wallet: {safe:string;usdg:string|null;holdings:{symbol:string;tokens:string|null}[]} | null): string | null {
  if (!wallet?.safe || wallet.usdg === null || wallet.holdings.some(holding => holding.tokens === null)) return null;
  return JSON.stringify([wallet.safe.toLowerCase(),wallet.usdg,...wallet.holdings.map(holding => [holding.symbol,holding.tokens])]);
}
