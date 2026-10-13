export async function recoverSessionRehearsals(db:D1Database,now=new Date()){
 // A crashed request must never become a retryable prepared intent. Keep the
 // known transaction identity and let exact-fill reconciliation decide outcome.
 return (await db.prepare(`UPDATE autonomous_rehearsal_intents SET state=CASE WHEN EXISTS(SELECT 1 FROM autonomous_transaction_journal j WHERE j.owner_ref=autonomous_rehearsal_intents.owner_ref AND j.intent_id=json_extract(preparation_json,'$.evidence.intentDigest') AND j.state='submitted') THEN 'submitted' ELSE 'unknown' END, transaction_hash=COALESCE(transaction_hash,(SELECT j.transaction_hash FROM autonomous_transaction_journal j WHERE j.owner_ref=autonomous_rehearsal_intents.owner_ref AND j.intent_id=json_extract(preparation_json,'$.evidence.intentDigest'))),updated_at=? WHERE state='attempting' AND updated_at<?`).bind(now.toISOString(),new Date(now.getTime()-120000).toISOString()).run()).meta.changes;
}
