// Encrypted session-signer records for a future owner-approved execution path. Material is
// AES-GCM encrypted at rest with STEWARD_SIGNER_ENCRYPTION_KEY and decryptable only inside
// the submission adapter. No HTTP route reads or returns it. Saving a record does not install
// any onchain grant; the policy lease binds its ciphertext reference. The key override keeps
// this module testable outside the Workers runtime; production callers omit it.
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function encryptionKey(keyOverride?: string): Promise<CryptoKey> {
  let raw = keyOverride;
  if (!raw) { const { env } = await import('cloudflare:workers'); raw = env.STEWARD_SIGNER_ENCRYPTION_KEY; }
  if (!raw) throw new Error('Session signer encryption is unavailable.');
  const bytes = decode(raw);
  if (bytes.length !== 32) throw new Error('Session signer encryption key must be 32 bytes.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export type SessionSignerRef = { address: string; ciphertextRef: string };
export const sessionSignerRef = (ownerRef: string, address: string): string =>
  `session_signers/${ownerRef}/${address.toLowerCase()}`;

export async function saveSessionSigner(db: D1Database, ownerRef: string, address: string, material: string, keyOverride?: string): Promise<SessionSignerRef> {
  if (!ownerRef || ownerRef.length > 200 || !/^0x[0-9a-f]{40}$/i.test(address) || !material || material.length > 512) throw Error('Invalid session signer record.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(keyOverride), new TextEncoder().encode(material));
  await db.prepare(`INSERT INTO session_signers (owner_ref, address, signer_iv, signer_ciphertext, created_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_ref, address) DO UPDATE SET signer_iv = excluded.signer_iv,
    signer_ciphertext = excluded.signer_ciphertext, created_at = excluded.created_at`)
    .bind(ownerRef, address.toLowerCase(), encode(iv), encode(new Uint8Array(ciphertext)), new Date().toISOString()).run();
  return { address: address.toLowerCase(), ciphertextRef: sessionSignerRef(ownerRef, address) };
}

export async function getSessionSignerRef(db: D1Database, ownerRef: string, address: string): Promise<SessionSignerRef | null> {
  const row = await db.prepare('SELECT address FROM session_signers WHERE owner_ref = ? AND address = ?')
    .bind(ownerRef, address.toLowerCase()).first<{ address: string }>();
  return row ? { address: row.address, ciphertextRef: sessionSignerRef(ownerRef, row.address) } : null;
}

// Decrypts signer material for the submission adapter only. Never returns over HTTP; a wrong
// or rotated key fails closed instead of yielding partial material.
export async function loadSessionSignerMaterial(db: D1Database, ownerRef: string, address: string, keyOverride?: string): Promise<string | null> {
  const row = await db.prepare('SELECT signer_iv, signer_ciphertext FROM session_signers WHERE owner_ref = ? AND address = ?')
    .bind(ownerRef, address.toLowerCase()).first<{ signer_iv: string; signer_ciphertext: string }>();
  if (!row) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(row.signer_iv) }, await encryptionKey(keyOverride), decode(row.signer_ciphertext));
    return new TextDecoder().decode(plain);
  } catch { return null; }
}

export async function removeSessionSigner(db: D1Database, ownerRef: string, address: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM session_signers WHERE owner_ref = ? AND address = ?')
    .bind(ownerRef, address.toLowerCase()).run();
  return result.meta.changes === 1;
}
