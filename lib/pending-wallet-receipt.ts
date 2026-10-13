export type PendingWalletReceipt = { hash: string; intentDigest: string };
// Browser recovery data is only a pointer. The server still checks ownership,
// the stored preparation and chain evidence; these values never authorize a buy.
export function parsePendingWalletReceipt(raw: string | null): PendingWalletReceipt | null {
  try {
    if (!raw || raw.length > 500) return null;
    const value = JSON.parse(raw) as PendingWalletReceipt;
    if (!/^0x[0-9a-f]{64}$/i.test(value.hash) || !/^0x[0-9a-f]{64}$/i.test(value.intentDigest)) return null;
    return { hash: value.hash.toLowerCase(), intentDigest: value.intentDigest.toLowerCase() };
  } catch { return null; }
}

export const pendingReceiptKey = (safe: string) => `steward-unsaved-receipt:${safe.toLowerCase()}`;
