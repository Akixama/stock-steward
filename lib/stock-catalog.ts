import { registry } from './robinhood-chain.ts';

export type StockCatalogItem = { symbol: string; name: string; kind?: 'memecoin' };

// Show only official Robinhood Chain assets that can be named and installed.
// A live route is checked separately before a permission or order is signed.
export function stockCatalog(body: unknown): StockCatalogItem[] {
  const active = new Set(registry(body)
    .filter((token) => token.status === 'ASSET_STATUS_ACTIVE' && /^[A-Z.]{1,8}$/.test(token.symbol))
    .map((token) => token.symbol));
  const assets = (body as { assets?: unknown[] }).assets ?? [];
  const bySymbol = new Map<string, StockCatalogItem>();
  for (const value of assets) {
    const asset = value as { tokenSymbol?: unknown; tokenName?: unknown };
    const symbol = asset.tokenSymbol;
    if (typeof symbol !== 'string' || !active.has(symbol) || bySymbol.has(symbol)) continue;
    const rawName = typeof asset.tokenName === 'string' ? asset.tokenName.trim() : '';
    const name = rawName.replace(/\s*[•·]\s*Robinhood Token$/i, '').trim();
    bySymbol.set(symbol, { symbol, name: name && name.length <= 100 ? name : symbol });
  }
  if (!bySymbol.size) throw new Error('No active stock tokens are available.');
  return [...bySymbol.values()].sort((a, b) => a.name.localeCompare(b.name) || a.symbol.localeCompare(b.symbol));
}
