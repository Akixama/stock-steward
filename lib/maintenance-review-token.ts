import { permissionWindow } from './permission-window.ts';

export type MaintenanceReviewClaims = {
  owner: string; kind: 'renew' | 'revoke'; digest: string;
  safe: string; module: string; startsAt: number; issuedAt: number;
  outputs: { token: string; fee: number; tickSpacing: number; minimumOutputRaw: string }[];
};

const encoder = new TextEncoder();
const lifetimeMs = 5 * 60_000;
const keyFor = (secret: string) => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const bytes = (value: string) => Uint8Array.from(Buffer.from(value, 'base64url'));

export async function issueMaintenanceReview(claims: MaintenanceReviewClaims, secret: string) {
  if (!secret) throw Error('Permission review signing is unavailable. Nothing was prepared.');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = await crypto.subtle.sign('HMAC', await keyFor(secret), encoder.encode(`maintenance-review-v1:${payload}`));
  return `${payload}.${Buffer.from(signature).toString('base64url')}`;
}

export async function verifyMaintenanceReview(token: unknown, secret: string, expected: {
  owner: string; kind: 'renew' | 'revoke'; digest: string; safe: string; module: string;
}, now = Date.now()): Promise<MaintenanceReviewClaims> {
  if (!secret || typeof token !== 'string' || token.length > 4096) throw Error('Permission review expired or changed. Review again before signing.');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) throw Error('Permission review expired or changed. Review again before signing.');
  let claims: MaintenanceReviewClaims;
  try {
    const valid = await crypto.subtle.verify('HMAC', await keyFor(secret), bytes(signature), encoder.encode(`maintenance-review-v1:${payload}`));
    if (!valid) throw Error('Invalid signature');
    claims = JSON.parse(new TextDecoder().decode(bytes(payload))) as MaintenanceReviewClaims;
  } catch { throw Error('Permission review expired or changed. Review again before signing.'); }
  if (claims.owner !== expected.owner || claims.kind !== expected.kind || claims.digest !== expected.digest
    || claims.safe.toLowerCase() !== expected.safe.toLowerCase() || claims.module.toLowerCase() !== expected.module.toLowerCase()
    || !Number.isSafeInteger(claims.issuedAt) || claims.issuedAt > now + 5000 || now - claims.issuedAt > lifetimeMs
    || !Number.isSafeInteger(claims.startsAt) || claims.startsAt !== permissionWindow(new Date(now)).startsAt
    || !Array.isArray(claims.outputs) || claims.outputs.length > 20
    || claims.outputs.some(output => !/^0x[0-9a-f]{40}$/i.test(output.token)
      || !Number.isSafeInteger(output.fee) || !Number.isSafeInteger(output.tickSpacing)
      || !/^\d+$/.test(output.minimumOutputRaw)))
    throw Error('Permission review expired or changed. Review again before signing.');
  return claims;
}
