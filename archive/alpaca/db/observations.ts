import type { Observation } from "../lib/anytime.ts";
export async function saveObservation(db: D1Database, owner: string, accountRef: string, record: Observation) {
  await db.prepare("INSERT INTO observations (id, owner_ref, account_ref, record_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(record.id, owner, accountRef, JSON.stringify(record), record.createdAt).run();
}
export async function listObservations(db: D1Database, owner: string, accountRef: string, limit = 10): Promise<Observation[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const rows = await db.prepare("SELECT record_json FROM observations WHERE owner_ref = ? AND account_ref = ? ORDER BY created_at DESC LIMIT ?")
    .bind(owner, accountRef, safeLimit).all<{ record_json: string }>();
  return rows.results.map(r => JSON.parse(r.record_json) as Observation);
}
