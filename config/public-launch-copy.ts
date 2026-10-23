// Keep the same eligibility and risk wording on the landing page, guide,
// terms and workspace. Updating this version requires a fresh agreement.
export const EXCLUDED_REGIONS = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'CH', name: 'Switzerland' },
] as const;
export const TERMS_VERSION = '2026-10-23-regions-v2';
export const TRADE_AGREEMENT_LABEL = `I accept the terms and the risks of real-money trading. I confirm I am not a US person and am not in the ${EXCLUDED_REGIONS.map(region=>region.name).join(', ')}.`;
export const US_RESTRICTION_TEXT = `Stock Tokens are unavailable in the ${EXCLUDED_REGIONS.map(region=>region.name).join(', ')} or to U.S. persons.`;
export const LOCATION_NOTICE = 'Your network appears to be in the United States, so trading is unavailable here. IP location is only a secondary signal and does not prove eligibility elsewhere.';
export const TRADING_RISK_TEXT = 'Stock Tokens are not shares. Their price can fall, a sale may return less than you paid, and network fees may be lost even if a transaction fails. Quotes and balances can be delayed. Review each exact action in your wallet before signing.';
export const GUARDRAIL_COPY = 'Buy, sell and send tokenized stocks from your own wallet within limits you set, with a receipt for every action.';
