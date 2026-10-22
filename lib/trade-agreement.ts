import { LOCATION_NOTICE, TERMS_VERSION } from '../config/public-launch-copy.ts';

type CountryRequest = Request & { cf?: { country?: string } };
type GeoConfig = object;

export function ipLocationBlock(request: Request, config: GeoConfig) {
  if ((config as { STEWARD_US_IP_BLOCK_ENABLED?: string }).STEWARD_US_IP_BLOCK_ENABLED !== 'true') return null;
  // Cloudflare's country is only a secondary blocking signal. A non-US or
  // missing value never establishes that a person is eligible to trade.
  const country = (request as CountryRequest).cf?.country ?? request.headers.get('cf-ipcountry');
  return country?.toUpperCase() === 'US' ? LOCATION_NOTICE : null;
}

export async function tradeAgreement(db: D1Database, owner: string) {
  const row = await db.prepare('SELECT terms_version, accepted_at, non_us_person FROM trade_agreements WHERE owner_ref=?')
    .bind(owner).first<{ terms_version: string; accepted_at: string; non_us_person: number }>();
  return row?.terms_version === TERMS_VERSION && row.non_us_person === 1 && Number.isFinite(Date.parse(row.accepted_at))
    ? { accepted: true as const, acceptedAt: row.accepted_at, termsVersion: TERMS_VERSION }
    : { accepted: false as const, acceptedAt: null, termsVersion: TERMS_VERSION };
}

export async function assertTradeAgreement(db: D1Database, owner: string, request: Request, config: GeoConfig) {
  const location = ipLocationBlock(request, config);
  if (location) throw Error(location);
  if (!(await tradeAgreement(db, owner)).accepted)
    throw Error('Accept the current terms and real-money risks, and confirm you are not a US person before trading. Nothing was sent.');
}

export async function saveTradeAgreement(db: D1Database, owner: string, now = new Date()) {
  const acceptedAt = now.toISOString();
  await db.prepare('INSERT INTO trade_agreements (owner_ref,terms_version,accepted_at,non_us_person) VALUES (?,?,?,1) '
    + 'ON CONFLICT(owner_ref) DO UPDATE SET terms_version=excluded.terms_version,accepted_at=excluded.accepted_at,non_us_person=1')
    .bind(owner, TERMS_VERSION, acceptedAt).run();
  return { accepted: true as const, acceptedAt, termsVersion: TERMS_VERSION };
}
