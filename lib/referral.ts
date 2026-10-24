// Referral rules shared by the server and the workspace.
// Points: a friend who signs up with your link earns you SIGNUP_POINTS.
// When that friend verifies a wallet, you earn VERIFIED_POINTS more.
export const SIGNUP_POINTS = 10;
export const VERIFIED_POINTS = 90;
export const REFERRAL_COOKIE = 'ss_ref';
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export function isReferralCode(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(value);
}

export function newReferralCode(random: (n: number) => Uint8Array = n => crypto.getRandomValues(new Uint8Array(n))): string {
  const bytes = random(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return code;
}

export function validDisplayName(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw Error('INVALID_NAME');
  const name = value.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 _.\-]{2,20}$/.test(name)) throw Error('INVALID_NAME');
  return name;
}

export function referralPoints(signups: number, verified: number): number {
  return signups * SIGNUP_POINTS + verified * VERIFIED_POINTS;
}

// Never show an email or wallet on the public board.
export function publicName(displayName: string | null, code: string): string {
  return displayName ?? `Steward ${code.slice(0, 4)}`;
}
