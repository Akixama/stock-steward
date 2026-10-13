// Persistent account-scoped inbox; no email, webhook or third-party delivery.
export async function collectAutonomousIncidents(db:D1Database,now=new Date()){
 const at=now.toISOString();
 const delayedAt=new Date(now.getTime()-5*60000).toISOString();
 const results=await db.batch([
  db.prepare(`INSERT INTO autonomous_incidents(id,owner_ref,kind,subject_id,severity,message,created_at)
   SELECT 'unknown:'||intent_id,owner_ref,'submission_unknown',intent_id,'critical','Submission outcome is uncertain. Funds remain reserved; do not submit this order again.',? FROM autonomous_transaction_journal WHERE state='unknown' AND settled_state IS NULL ON CONFLICT DO NOTHING`).bind(at),
  db.prepare(`INSERT INTO autonomous_incidents(id,owner_ref,kind,subject_id,severity,message,created_at)
   SELECT 'settled:'||intent_id,owner_ref,'submission_'||settled_state,intent_id,CASE WHEN settled_state='confirmed' THEN 'info' ELSE 'warning' END,CASE WHEN settled_state='confirmed' THEN 'The purchase receipt was verified and its account lock released.' ELSE 'The transaction reverted. Check the receipt before preparing another order.' END,? FROM autonomous_transaction_journal WHERE settled_state IS NOT NULL ON CONFLICT DO NOTHING`).bind(at),
  db.prepare(`INSERT INTO autonomous_incidents(id,owner_ref,kind,subject_id,severity,message,created_at)
   SELECT 'paused:'||owner_ref||':'||revision,owner_ref,'shadow_circuit_breaker',CAST(revision AS TEXT),'warning','Preview checks paused after repeated errors. Review the latest receipts before restarting.',? FROM autonomous_shadow_plans WHERE enabled=0 AND failures>=3 ON CONFLICT DO NOTHING`).bind(at),
  db.prepare(`INSERT INTO autonomous_incidents(id,owner_ref,kind,subject_id,severity,message,created_at)
   SELECT 'delayed:'||intent_id,owner_ref,'receipt_delayed',intent_id,'warning','Purchase verification is taking longer than five minutes. Your budget remains reserved. Check the transaction receipt; do not place the same order again.',? FROM autonomous_transaction_journal WHERE state IN ('submitted','broadcasting') AND settled_state IS NULL AND created_at<=? ON CONFLICT DO NOTHING`).bind(at,delayedAt),
 ]);return results.reduce((sum,result)=>sum+result.meta.changes,0);
}
export async function listAutonomousIncidents(db:D1Database,owner:string){return (await db.prepare('SELECT id,kind,severity,message,created_at,acknowledged_at FROM autonomous_incidents WHERE owner_ref=? ORDER BY created_at DESC,id DESC LIMIT 50').bind(owner).all()).results;}
export async function acknowledgeAutonomousIncident(db:D1Database,owner:string,id:string,now=new Date()){
 if(!id||id.length>250)return false;
 return (await db.prepare('UPDATE autonomous_incidents SET acknowledged_at=? WHERE owner_ref=? AND id=? AND acknowledged_at IS NULL').bind(now.toISOString(),owner,id).run()).meta.changes===1;
}
