import type {RouterCandidate} from '../lib/router-candidate.ts';
export type AttemptPlan={owner:string;address:string;intentDigest:string;mandateVersion:number;day:string;amountCents:number;dailyCapCents:number;candidate:RouterCandidate};
export type AttemptState='reserved'|'attempting'|'submitted'|'unknown'|'confirmed'|'reverted'|'released';
export type Attempt={id:string;owner_ref:string;address:string;intent_digest:string;mandate_version:number;execution_day:string;amount_cents:number;state:AttemptState;plan_json:string;transaction_hash:string|null;created_at:string;updated_at:string};
function valid(plan:AttemptPlan){if(!plan.owner||plan.owner.length>200||!/^0x[0-9a-f]{40}$/i.test(plan.address)||!/^0x[0-9a-f]{64}$/.test(plan.intentDigest)||plan.candidate.intentDigest!==plan.intentDigest||plan.candidate.from.toLowerCase()!==plan.address.toLowerCase()||!Number.isSafeInteger(plan.mandateVersion)||plan.mandateVersion<1||!/^\d{4}-\d{2}-\d{2}$/.test(plan.day)||!Number.isSafeInteger(plan.amountCents)||plan.amountCents<1||!Number.isSafeInteger(plan.dailyCapCents)||plan.dailyCapCents<plan.amountCents||plan.dailyCapCents>100000000)throw Error('Invalid attempt plan');}
// Internal storage foundation only. No HTTP submission route or live signer calls this module.
export async function reserveAttempt(db:D1Database,plan:AttemptPlan,now=new Date()){
 valid(plan);if(plan.day!==now.toISOString().slice(0,10))throw Error('Execution day changed');const address=plan.address.toLowerCase(),id=plan.intentDigest;
 const results=await db.batch([
 db.prepare(`INSERT INTO autonomy_spends(owner_ref,address,execution_day,intent_id,amount_cents,state)
 SELECT ?,?,?,?,?,'reserved' WHERE NOT EXISTS(SELECT 1 FROM execution_attempts WHERE id=?) AND COALESCE((SELECT SUM(amount_cents) FROM autonomy_spends WHERE owner_ref=? AND address=? AND (state IN ('reserved','submitted','unknown') OR (execution_day=? AND state='confirmed'))),0)<=?
 ON CONFLICT(owner_ref,address,intent_id) DO NOTHING`).bind(plan.owner,address,plan.day,id,plan.amountCents,id,plan.owner,address,plan.day,plan.dailyCapCents-plan.amountCents),
 db.prepare(`INSERT INTO execution_attempts(id,owner_ref,address,intent_digest,mandate_version,execution_day,amount_cents,state,plan_json,created_at,updated_at)
 SELECT ?,?,?,?,?,?,?,'reserved',?,?,? WHERE EXISTS(SELECT 1 FROM autonomy_spends WHERE owner_ref=? AND address=? AND intent_id=? AND execution_day=? AND amount_cents=? AND state='reserved')
 ON CONFLICT(id) DO NOTHING`).bind(id,plan.owner,address,id,plan.mandateVersion,plan.day,plan.amountCents,JSON.stringify(plan),now.toISOString(),now.toISOString(),plan.owner,address,id,plan.day,plan.amountCents),
 ]);return results[1].meta.changes===1;
}
export async function getAttempt(db:D1Database,owner:string,id:string){return db.prepare('SELECT * FROM execution_attempts WHERE owner_ref=? AND id=?').bind(owner,id).first<Attempt>();}
export async function beginAttempt(db:D1Database,owner:string,id:string,version:number,now=new Date()){
 const result=await db.prepare("UPDATE execution_attempts SET state='attempting',updated_at=? WHERE owner_ref=? AND id=? AND state='reserved' AND mandate_version=? AND execution_day=?").bind(now.toISOString(),owner,id,version,now.toISOString().slice(0,10)).run();return result.meta.changes===1;
}
async function transition(db:D1Database,owner:string,id:string,from:AttemptState[],to:AttemptState,hash:string|null,now:Date){
 if(hash!==null&&!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Invalid transaction hash');
 const placeholders=from.map(()=>'?').join(',');
 const output=await db.batch([
 db.prepare(`UPDATE execution_attempts SET state=?,transaction_hash=COALESCE(transaction_hash,?),updated_at=? WHERE owner_ref=? AND id=? AND state IN (${placeholders}) AND (transaction_hash IS NULL OR transaction_hash=? OR ? IS NULL) AND (? IS NULL OR NOT EXISTS(SELECT 1 FROM execution_attempts other WHERE other.transaction_hash=? AND other.id<>?))`).bind(to,hash,now.toISOString(),owner,id,...from,hash,hash,hash,hash,id),
 db.prepare(`UPDATE autonomy_spends SET state=? WHERE owner_ref=? AND intent_id=? AND EXISTS(SELECT 1 FROM execution_attempts a WHERE a.id=autonomy_spends.intent_id AND a.owner_ref=autonomy_spends.owner_ref AND a.address=autonomy_spends.address AND a.state=?)`).bind(to==='attempting'?'reserved':to==='reverted'?'released':to,owner,id,to),
 ]);return output[0].meta.changes===1;
}
export const recordUnknown=(db:D1Database,owner:string,id:string,now=new Date())=>transition(db,owner,id,['attempting','submitted'],'unknown',null,now);
export const recordSubmission=(db:D1Database,owner:string,id:string,hash:string,now=new Date())=>transition(db,owner,id,['attempting','unknown'],'submitted',hash.toLowerCase(),now);
// A process restart cannot establish whether a request left the process. Keep the reservation.
export const recoverInterruptedAttempt=(db:D1Database,owner:string,id:string,now=new Date())=>transition(db,owner,id,['attempting'],'unknown',null,now);
// Only an unattempted reservation can be canceled without final chain evidence.
export const cancelReservation=(db:D1Database,owner:string,id:string,now=new Date())=>transition(db,owner,id,['reserved'],'released',null,now);
export async function settleAttempt(db:D1Database,owner:string,id:string,proof:{hash:string;canonicalFinalized:boolean;outcome:'verified_fill'|'reverted'|'unknown';intentDigest:string},now=new Date()){
 // Trusted internal reconciliation only. Never accept these proof fields from a browser.
 // No chain-to-fill proof adapter is installed; successful outer receipts remain unknown.
 if(!proof.canonicalFinalized||proof.intentDigest!==id||proof.outcome==='unknown')return false;
 const attempt=await getAttempt(db,owner,id);if(!attempt?.transaction_hash||attempt.transaction_hash.toLowerCase()!==proof.hash.toLowerCase())return false;
 return transition(db,owner,id,['submitted','unknown'],proof.outcome==='verified_fill'?'confirmed':'reverted',proof.hash.toLowerCase(),now);
}
