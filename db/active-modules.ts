import { PERMISSION_WINDOW_SECONDS } from '../lib/permission-window.ts';
export type StoredOutput = { token: string; fee: number; tickSpacing: number; minimumOutputRaw: string };
export type ActiveModule = { safe: string; module: string; mandateVersion: number; verifiedAt: string; outputs: StoredOutput[] | null; startsAt: number; expiresAt: number };

// Posting install-time prices must not discard an existing module's dates.
// Only a record for this exact module may supply its installed window.
export function moduleRecordContext(current: ActiveModule | null, module: string, outputs: unknown) {
  const matching = current?.module.toLowerCase() === module.toLowerCase() ? current : null;
  return {
    outputs: outputs === undefined ? matching?.outputs ?? null : parseStoredOutputs(outputs),
    window: matching ? { startsAt: matching.startsAt, expiresAt: matching.expiresAt } : undefined,
  };
}

const POOL_TIERS: ReadonlyArray<readonly [number, number]> = [[100, 1], [500, 10], [3000, 60], [10000, 200]];

// The exact pool prices locked in when the permission was turned on. Orders must
// carry these verbatim: the onchain conditions pin the install-time bytes, so a
// fresh quote can never satisfy them. Strict on the way in, lenient on the way
// out (garbage reads as missing, which fails closed into re-activation).
export function parseStoredOutputs(raw: unknown): StoredOutput[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) return null;
  const seen = new Set<string>();
  const out: StoredOutput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { token, fee, tickSpacing, minimumOutputRaw } = entry as Record<string, unknown>;
    if (typeof token !== "string" || !/^0x[0-9a-f]{40}$/i.test(token)) return null;
    if (seen.has(token.toLowerCase())) return null;
    seen.add(token.toLowerCase());
    if (!POOL_TIERS.some(([tierFee, tierSpacing]) => tierFee === fee && tierSpacing === tickSpacing)) return null;
    if (typeof minimumOutputRaw !== "string" || !/^\d{1,39}$/.test(minimumOutputRaw) || BigInt(minimumOutputRaw) <= 0n) return null;
    out.push({ token: (token as string).toLowerCase(), fee: fee as number, tickSpacing: tickSpacing as number, minimumOutputRaw });
  }
  return out;
}

// The wallet's verified permission module, recorded once activation (or a later
// resume) proves it onchain. Scoped to the mandate version that created it: a new
// version needs its own activation, so a stale address can never linger.
export async function getActiveModule(db: D1Database, owner: string, version: number): Promise<ActiveModule | null> {
  const row = await db.prepare("SELECT safe,module,mandate_version,verified_at,outputs,starts_at,expires_at FROM active_modules WHERE owner_ref=? AND mandate_version=?")
    .bind(owner, version)
    .first<{ safe: string; module: string; mandate_version: number; verified_at: string; outputs: string | null; starts_at: number | null; expires_at: number | null }>();
  if (!row) return null;
  let outputs: StoredOutput[] | null = null;
  if (row.outputs !== null) {
    try {
      outputs = parseStoredOutputs(JSON.parse(row.outputs));
    } catch { outputs = null; }
  }
  const originalDay = Math.floor(Date.parse(row.verified_at) / 86400000) * 86400;
  const startsAt = row.starts_at ?? originalDay, expiresAt = row.expires_at ?? originalDay + PERMISSION_WINDOW_SECONDS;
  if (!Number.isSafeInteger(startsAt) || startsAt < 1 || startsAt % 86400 || expiresAt !== startsAt + PERMISSION_WINDOW_SECONDS) throw new Error('Invalid installed permission window.');
  return { safe: row.safe, module: row.module, mandateVersion: row.mandate_version, verifiedAt: row.verified_at, outputs, startsAt, expiresAt };
}

export async function saveActiveModule(db: D1Database, owner: string, version: number, safe: string, module: string, outputs?: StoredOutput[] | null, now = new Date(), window?: { startsAt: number; expiresAt: number }) {
  if (!/^0x[0-9a-f]{40}$/i.test(safe) || !/^0x[0-9a-f]{40}$/i.test(module)) throw new Error("Invalid module record.");
  const parsed = outputs === undefined || outputs === null ? null : parseStoredOutputs(outputs);
  if ((outputs !== undefined && outputs !== null) && parsed === null) throw new Error("Invalid locked outputs.");
  const startsAt = window?.startsAt ?? Math.floor(now.getTime() / 86400000) * 86400, expiresAt = window?.expiresAt ?? startsAt + PERMISSION_WINDOW_SECONDS;
  if (!Number.isSafeInteger(startsAt) || startsAt < 1 || startsAt % 86400 || expiresAt !== startsAt + PERMISSION_WINDOW_SECONDS) throw new Error('Invalid installed permission window.');
  await db.prepare(`INSERT INTO active_modules(owner_ref,mandate_version,safe,module,verified_at,outputs,starts_at,expires_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(owner_ref,mandate_version) DO UPDATE SET safe=excluded.safe,module=excluded.module,verified_at=excluded.verified_at,outputs=excluded.outputs,starts_at=excluded.starts_at,expires_at=excluded.expires_at`)
    .bind(owner, version, safe.toLowerCase(), module.toLowerCase(), now.toISOString(), parsed === null ? null : JSON.stringify(parsed), startsAt, expiresAt).run();
}
