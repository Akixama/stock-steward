export type ActiveModule = { safe: string; module: string; mandateVersion: number; verifiedAt: string };

// The wallet's verified permission module, recorded once activation (or a later
// resume) proves it onchain. Scoped to the mandate version that created it: a new
// version needs its own activation, so a stale address can never linger.
export async function getActiveModule(db: D1Database, owner: string, version: number): Promise<ActiveModule | null> {
  const row = await db.prepare("SELECT safe,module,mandate_version,verified_at FROM active_modules WHERE owner_ref=? AND mandate_version=?")
    .bind(owner, version)
    .first<{ safe: string; module: string; mandate_version: number; verified_at: string }>();
  return row ? { safe: row.safe, module: row.module, mandateVersion: row.mandate_version, verifiedAt: row.verified_at } : null;
}

export async function saveActiveModule(db: D1Database, owner: string, version: number, safe: string, module: string, now = new Date()) {
  if (!/^0x[0-9a-f]{40}$/i.test(safe) || !/^0x[0-9a-f]{40}$/i.test(module)) throw new Error("Invalid module record.");
  await db.prepare(`INSERT INTO active_modules(owner_ref,mandate_version,safe,module,verified_at) VALUES(?,?,?,?,?)
    ON CONFLICT(owner_ref,mandate_version) DO UPDATE SET safe=excluded.safe,module=excluded.module,verified_at=excluded.verified_at`)
    .bind(owner, version, safe.toLowerCase(), module.toLowerCase(), now.toISOString()).run();
}
