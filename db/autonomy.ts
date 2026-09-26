import type { AutonomyReceipt } from '../lib/autonomy.ts';
export async function listAutonomyRuns(db: D1Database, owner: string): Promise<AutonomyReceipt[]> {
  const rows = await db.prepare('SELECT receipt_json FROM autonomy_runs WHERE owner_ref=? ORDER BY created_at DESC,id DESC LIMIT 20').bind(owner).all<{receipt_json:string}>();
  return rows.results.map(row=>JSON.parse(row.receipt_json));
}
export async function saveAutonomyRun(db: D1Database, owner: string, receipt: AutonomyReceipt) {
  await db.prepare('INSERT INTO autonomy_runs(id,owner_ref,address,receipt_json,created_at) VALUES(?,?,?,?,?)')
    .bind(receipt.id,owner,receipt.address,JSON.stringify(receipt),receipt.createdAt).run();
}
// Not reachable from any spending endpoint. An atomic conditional INSERT serializes the
// daily cap across independent workers. A duplicate intent cannot reserve twice.
export async function reserveSpend(db: D1Database, owner: string, address: string, day: string, intent: string, amount: number, cap: number) {
  if (!/^0x[0-9a-f]{40}$/i.test(address) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[a-zA-Z0-9_-]{1,100}$/.test(intent) ||
    !Number.isSafeInteger(amount) || amount<=0 || !Number.isSafeInteger(cap) || cap<=0 || cap>100000000 || amount>cap) throw new Error('Invalid reservation');
  const result=await db.prepare(`INSERT INTO autonomy_spends(owner_ref,address,execution_day,intent_id,amount_cents,state)
    SELECT ?,?,?,?,?, 'reserved' WHERE COALESCE((SELECT SUM(amount_cents) FROM autonomy_spends
    WHERE owner_ref=? AND address=? AND (state IN ('reserved','submitted','unknown') OR (execution_day=? AND state='confirmed'))),0) <= ?
    ON CONFLICT(owner_ref,address,intent_id) DO NOTHING`)
    .bind(owner,address.toLowerCase(),day,intent,amount,owner,address.toLowerCase(),day,cap-amount).run();
  return result.meta.changes===1;
}
