export function portfolioValue(cashMicro: bigint | null, stockHoldings: number, stockSubtotalMicro: bigint | null): bigint | null {
  if (cashMicro === null) return null;
  if (stockHoldings === 0) return cashMicro;
  return stockSubtotalMicro === null ? null : cashMicro + stockSubtotalMicro;
}

export function walletBalanceFingerprint(wallet: {safe:string;usdg:string|null;holdings:{symbol:string;tokens:string|null}[]} | null): string | null {
  if (!wallet?.safe || wallet.usdg === null || wallet.holdings.some(holding => holding.tokens === null)) return null;
  return JSON.stringify([wallet.safe.toLowerCase(),wallet.usdg,...wallet.holdings.map(holding => [holding.symbol,holding.tokens])]);
}
