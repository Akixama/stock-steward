export type WalletBalance = {
  safe: string;
  usdg: string | null;
  holdings: { symbol: string; tokens: string | null }[];
  verified: boolean;
  balanceReadComplete?: boolean;
  checkedAt?: string | null;
};

export function completeWalletBalance(wallet: WalletBalance | null): wallet is WalletBalance & { usdg: string; checkedAt: string } {
  return Boolean(wallet?.verified && wallet.balanceReadComplete && wallet.usdg !== null &&
    wallet.holdings.every(item => item.tokens !== null) && wallet.checkedAt &&
    Number.isFinite(Date.parse(wallet.checkedAt)));
}

export function stockHoldingCount(wallet: WalletBalance | null): number | null {
  return completeWalletBalance(wallet)
    ? wallet.holdings.filter(item => Number(item.tokens) > 0).length : null;
}

export function parseLastVerifiedBalance(raw: string | null, safe?: string): WalletBalance | null {
  if (!raw) return null;
  try {
    const candidate = JSON.parse(raw) as WalletBalance;
    return typeof candidate?.safe === 'string' && /^0x[0-9a-f]{40}$/i.test(candidate.safe) &&
      (!safe || candidate.safe.toLowerCase() === safe.toLowerCase()) && completeWalletBalance(candidate)
      ? candidate : null;
  } catch { return null; }
}
