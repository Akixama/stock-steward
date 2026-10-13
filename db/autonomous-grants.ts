import type {draftAutonomousGrant} from '../lib/autonomous-grant.ts';
export type SessionGrantRow={id:string;state:string;session_address:string;mandate_version:number;policy_json:string;lease_json:string;transaction_json:string;created_at:string;creation_transaction:string|null;grant_transaction:string|null;verified_at:string|null};
export async function getSessionGrant(db:D1Database,owner:string){return db.prepare('SELECT id,state,session_address,mandate_version,policy_json,lease_json,transaction_json,created_at,creation_transaction,grant_transaction,verified_at FROM autonomous_session_grants WHERE owner_ref=?').bind(owner).first<SessionGrantRow>();}
export async function saveSessionGrantDraft(db:D1Database,owner:string,draft:ReturnType<typeof draftAutonomousGrant>){
 const id=crypto.randomUUID();
 // Refuse to overwrite any draft or unresolved active session. Enrollment requires
 // an explicit lifecycle; repeated requests cannot silently create additional keys.
 const result=await db.prepare(`INSERT INTO autonomous_session_grants(owner_ref,id,state,session_address,mandate_version,policy_json,lease_json,transaction_json,created_at) VALUES(?,?,'draft',?,?,?,?,?,?) ON CONFLICT DO NOTHING`).bind(owner,id,draft.policy.session.toLowerCase(),draft.lease.mandateVersion,JSON.stringify(draft.policy),JSON.stringify(draft.lease),JSON.stringify({from:draft.from,to:draft.to,value:draft.value,data:draft.data}),new Date().toISOString()).run();return result.meta.changes===1?id:null;
}

export async function recordSessionGrantVerification(db:D1Database,owner:string,id:string,creation:string,grant:string,at:string){return (await db.prepare("UPDATE autonomous_session_grants SET state='verified',creation_transaction=?,grant_transaction=?,verified_at=? WHERE owner_ref=? AND id=? AND state='draft'").bind(creation,grant,at,owner,id).run()).meta.changes===1;}
export async function pauseSessionGrant(db:D1Database,owner:string,id:string){return (await db.prepare("UPDATE autonomous_session_grants SET state='paused' WHERE owner_ref=? AND id=? AND state IN ('draft','verified')").bind(owner,id).run()).meta.changes===1;}
