import type { RolesPolicy } from '../lib/roles-permission.ts';

export type MaintenanceKind = 'renew' | 'revoke';
export type MaintenanceState = 'prepared' | 'submitted' | 'unknown' | 'confirmed' | 'reverted';
export type MaintenanceTransaction = { from: string; to: string; data: string; value: '0x0' };
export type MaintenanceAttempt = {
  id: string; owner: string; ownerAddress: string; safe: string; module: string;
  mandateVersion: number; kind: MaintenanceKind; state: MaintenanceState;
  transaction: MaintenanceTransaction; hash: string | null;
  policy: RolesPolicy;
  startsAt: number; expiresAt: number; createdAt: string;
};

function read(row: Record<string, unknown> | null): MaintenanceAttempt | null {
  if (!row) return null;
  return {
    id: String(row.id), owner: String(row.owner_ref), ownerAddress: String(row.owner_address),
    safe: String(row.safe), module: String(row.module), mandateVersion: Number(row.mandate_version),
    kind: row.kind as MaintenanceKind, state: row.state as MaintenanceState,
    transaction: JSON.parse(String(row.transaction_json)) as MaintenanceTransaction,
    policy: JSON.parse(String(row.policy_json)) as RolesPolicy,
    hash: row.transaction_hash === null ? null : String(row.transaction_hash),
    startsAt: Number(row.starts_at), expiresAt: Number(row.expires_at), createdAt: String(row.created_at),
  };
}

export async function latestMaintenance(db: D1Database, owner: string, safe: string) {
  const row = await db.prepare(`SELECT * FROM permission_maintenance_attempts
    WHERE owner_ref=? AND safe=? ORDER BY created_at DESC LIMIT 1`).bind(owner,safe.toLowerCase()).first();
  return read(row);
}

export async function maintenanceById(db: D1Database, owner: string, id: string) {
  const row = await db.prepare('SELECT * FROM permission_maintenance_attempts WHERE owner_ref=? AND id=?')
    .bind(owner,id).first();
  return read(row);
}

export async function unresolvedMaintenance(db: D1Database, owner: string, safe: string) {
  const row = await db.prepare(`SELECT * FROM permission_maintenance_attempts
    WHERE owner_ref=? AND safe=? AND state IN ('prepared','submitted','unknown')
    ORDER BY created_at DESC LIMIT 1`).bind(owner,safe.toLowerCase()).first();
  return read(row);
}

export async function reserveMaintenance(db: D1Database, input: Omit<MaintenanceAttempt,'id'|'state'|'hash'|'createdAt'>, now = new Date()) {
  const id = crypto.randomUUID(), stamp = now.toISOString();
  // A prepared request is unresolved even without a hash: the wallet may have
  // sent it just before a tab reload. Never offer a second signature blindly.
  const result = await db.prepare(`INSERT INTO permission_maintenance_attempts
    (id,owner_ref,owner_address,safe,module,mandate_version,kind,state,transaction_json,policy_json,transaction_hash,starts_at,expires_at,created_at,updated_at)
    SELECT ?,?,?,?,?,?,?,'prepared',?,?,NULL,?,?,?,?
    WHERE NOT EXISTS (SELECT 1 FROM permission_maintenance_attempts
      WHERE owner_ref=? AND safe=? AND state IN ('prepared','submitted','unknown'))`)
    .bind(id,input.owner,input.ownerAddress.toLowerCase(),input.safe.toLowerCase(),input.module.toLowerCase(),
      input.mandateVersion,input.kind,JSON.stringify(input.transaction),JSON.stringify(input.policy),input.startsAt,input.expiresAt,stamp,stamp,
      input.owner,input.safe.toLowerCase()).run();
  return result.meta.changes === 1 ? id : null;
}

export async function recordMaintenanceHash(db: D1Database, owner: string, id: string, hash: string, now = new Date()) {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) return false;
  const result = await db.prepare(`UPDATE permission_maintenance_attempts SET state='submitted',transaction_hash=?,updated_at=?
    WHERE id=? AND owner_ref=? AND state='prepared' AND transaction_hash IS NULL`)
    .bind(hash.toLowerCase(),now.toISOString(),id,owner).run();
  return result.meta.changes === 1;
}

export async function settleMaintenance(db: D1Database, owner: string, id: string,
  state: 'confirmed' | 'reverted' | 'unknown', now = new Date()) {
  const result = await db.prepare(`UPDATE permission_maintenance_attempts SET state=?,updated_at=?
    WHERE id=? AND owner_ref=? AND state IN ('submitted','unknown') AND transaction_hash IS NOT NULL`)
    .bind(state,now.toISOString(),id,owner).run();
  return result.meta.changes === 1;
}
