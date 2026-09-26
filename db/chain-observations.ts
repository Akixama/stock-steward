import type { PricedObservation } from "../lib/chain-analysis.ts";
export async function listChainObservations(db: D1Database, owner: string, address?: string): Promise<PricedObservation[]> {
  const statement = address ? db.prepare("SELECT record_json FROM chain_observations WHERE owner_ref = ? AND address = ? ORDER BY created_at DESC, id DESC LIMIT 20").bind(owner, address.toLowerCase()) : db.prepare("SELECT record_json FROM chain_observations WHERE owner_ref = ? ORDER BY created_at DESC, id DESC LIMIT 20").bind(owner);
  const rows = await statement.all<{ record_json: string }>();
  return rows.results.map(r => JSON.parse(r.record_json) as PricedObservation);
}
export async function saveChainObservation(db: D1Database, owner: string, record: PricedObservation) {
  await db.prepare("INSERT INTO chain_observations (id, owner_ref, address, record_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(record.id, owner, record.address.toLowerCase(), JSON.stringify(record), record.observedAt).run();
}
export async function claimChainRead(db: D1Database, owner: string): Promise<boolean> {
  const now = new Date().toISOString(), next = new Date(Date.now() + 15_000).toISOString();
  const result = await db.prepare("INSERT INTO chain_read_gates (owner_ref, next_available_at) VALUES (?, ?) ON CONFLICT(owner_ref) DO UPDATE SET next_available_at = excluded.next_available_at WHERE chain_read_gates.next_available_at <= ?")
    .bind(owner, next, now).run();
  return result.meta.changes === 1;
}
