import {keccak256,type Hex} from 'viem';
// Signed transactions contain public transaction data, not private signer keys.
// Persist before broadcast. An uncertain broadcast is never automatically retried.
export async function journalSessionTransaction(db:D1Database,owner:string,intent:string,session:string,nonce:number,raw:Hex,now=new Date()){
 if(!owner||owner.length>200||!/^0x[0-9a-f]{64}$/i.test(intent)||!/^0x[0-9a-f]{40}$/i.test(session)||!Number.isSafeInteger(nonce)||nonce<0||!/^0x(?:[0-9a-f]{2})+$/i.test(raw)||raw.length>100000)throw Error('Invalid session journal entry.');
 const hash=keccak256(raw);
 const result=await db.prepare(`INSERT INTO autonomous_transaction_journal(intent_id,owner_ref,session_address,nonce,transaction_hash,raw_transaction,state,created_at,updated_at) VALUES(?,?,?,?,?,?,'signed',?,?) ON CONFLICT DO NOTHING`).bind(intent,owner,session.toLowerCase(),nonce,hash,raw,now.toISOString(),now.toISOString()).run();
 return result.meta.changes===1?hash:null;
}
export async function beginSessionBroadcast(db:D1Database,owner:string,intent:string,now=new Date()){
 const result=await db.prepare("UPDATE autonomous_transaction_journal SET state='broadcasting',updated_at=? WHERE owner_ref=? AND intent_id=? AND state='signed'").bind(now.toISOString(),owner,intent).run();return result.meta.changes===1;
}
export async function finishSessionBroadcast(db:D1Database,owner:string,intent:string,submitted:boolean,now=new Date()){
 return (await db.prepare("UPDATE autonomous_transaction_journal SET state=?,updated_at=? WHERE owner_ref=? AND intent_id=? AND state='broadcasting'").bind(submitted?'submitted':'unknown',now.toISOString(),owner,intent).run()).meta.changes===1;
}
export async function recoverSessionBroadcasts(db:D1Database,now=new Date()){
 // Preserve hash, nonce and budget. An interrupted request may already be onchain.
 return (await db.prepare("UPDATE autonomous_transaction_journal SET state='unknown',updated_at=? WHERE state='broadcasting' AND updated_at<?").bind(now.toISOString(),new Date(now.getTime()-120000).toISOString()).run()).meta.changes;
}

export async function claimAutonomousAccount(db:D1Database,owner:string,account:string,intent:string,now=new Date()){
 const result=await db.prepare(`INSERT INTO autonomous_account_locks(account_address,owner_ref,intent_id,created_at)
 SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM execution_attempts WHERE address=? AND state IN ('reserved','attempting','submitted','unknown')) ON CONFLICT DO NOTHING`).bind(account.toLowerCase(),owner,intent,now.toISOString(),account.toLowerCase()).run();return result.meta.changes===1;
}
export async function releaseAutonomousAccount(db:D1Database,owner:string,intent:string){
 // Never release an uncertain/submitted attempt. Reconciliation must prove its outcome.
 return (await db.prepare(`DELETE FROM autonomous_account_locks WHERE owner_ref=? AND intent_id=? AND NOT EXISTS(SELECT 1 FROM execution_attempts WHERE id=? AND state IN ('reserved','attempting','submitted','unknown'))`).bind(owner,intent,intent).run()).meta.changes===1;
}

export async function settleSessionJournals(db:D1Database,now=new Date()){
 // execution_attempts reaches terminal states only through trusted exact-fill
 // reconciliation. The journal cannot turn an outer-success receipt into a fill.
 const results=await db.batch([
  db.prepare(`UPDATE autonomous_transaction_journal SET settled_state=(SELECT a.state FROM execution_attempts a WHERE a.id=intent_id AND a.owner_ref=autonomous_transaction_journal.owner_ref AND a.transaction_hash=autonomous_transaction_journal.transaction_hash),updated_at=? WHERE settled_state IS NULL AND state IN ('submitted','unknown','broadcasting') AND EXISTS(SELECT 1 FROM execution_attempts a WHERE a.id=intent_id AND a.owner_ref=autonomous_transaction_journal.owner_ref AND a.transaction_hash=autonomous_transaction_journal.transaction_hash AND a.state IN ('confirmed','reverted'))`).bind(now.toISOString()),
  db.prepare(`DELETE FROM autonomous_account_locks WHERE EXISTS(SELECT 1 FROM execution_attempts a WHERE a.id=autonomous_account_locks.intent_id AND a.owner_ref=autonomous_account_locks.owner_ref AND a.address=autonomous_account_locks.account_address AND a.state IN ('confirmed','reverted','released'))`),
 ]);return {settled:results[0].meta.changes,unlocked:results[1].meta.changes};
}
