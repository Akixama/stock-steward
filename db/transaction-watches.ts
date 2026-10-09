import type {TransactionWatch} from '../lib/chain-reconciliation.ts';
export async function listWatches(db:D1Database,owner:string){return (await db.prepare('SELECT record_json FROM chain_transaction_watches WHERE owner_ref=? ORDER BY checked_at DESC LIMIT 5').bind(owner).all<{record_json:string}>()).results.map(row=>JSON.parse(row.record_json) as TransactionWatch);}
export async function saveWatch(db:D1Database,owner:string,watch:TransactionWatch){
  const result=await db.prepare(`INSERT INTO chain_transaction_watches(id,owner_ref,address,transaction_hash,record_json,created_at,checked_at)
    SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM chain_transaction_watches WHERE owner_ref=?)<5 OR EXISTS(SELECT 1 FROM chain_transaction_watches WHERE id=? AND owner_ref=?)
    ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,checked_at=excluded.checked_at WHERE chain_transaction_watches.owner_ref=excluded.owner_ref AND chain_transaction_watches.checked_at<=excluded.checked_at`)
    .bind(watch.id,owner,watch.address,watch.hash,JSON.stringify(watch),watch.createdAt,watch.checkedAt,owner,watch.id,owner).run();return result.meta.changes===1;
}
export async function refreshWatch(db:D1Database,owner:string,watch:TransactionWatch,previousCheckedAt:string){
  await db.prepare('UPDATE chain_transaction_watches SET record_json=?,checked_at=? WHERE owner_ref=? AND id=? AND checked_at=?')
    .bind(JSON.stringify(watch),watch.checkedAt,owner,watch.id,previousCheckedAt).run();
}
