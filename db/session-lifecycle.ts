import type {SessionGrantRow} from './autonomous-grants.ts';import type {inspectSessionRetirement} from '../lib/session-retirement.ts';
import {compileRolesPolicy} from '../lib/roles-permission.ts';
type Proof=Awaited<ReturnType<typeof inspectSessionRetirement>>;
export async function retireSessionGrant(db:D1Database,owner:string,grant:SessionGrantRow,proof:Proof){
 const policy=JSON.parse(grant.policy_json);if(!['draft','paused'].includes(grant.state)||proof.policyHash!==compileRolesPolicy(policy).policyHash||proof.owner!==JSON.parse(grant.lease_json).owner||proof.member!==false||proof.account!==policy.account.toLowerCase()||proof.session!==grant.session_address.toLowerCase()||!Number.isFinite(Date.parse(proof.observedAt))||Date.now()-Date.parse(proof.observedAt)<0||Date.now()-Date.parse(proof.observedAt)>30000)return false;
 // Archive/delete atomically. Preserve signer ciphertext and all transaction and
 // accounting records. A new grant cannot hide an unresolved old purchase.
 const results=await db.batch([
 db.prepare(`INSERT INTO autonomous_session_archive(id,owner_ref,account_address,grant_json,retirement_json,retired_at) SELECT id,owner_ref,?,?,?,? FROM autonomous_session_grants WHERE owner_ref=? AND id=? AND state=? AND NOT EXISTS(SELECT 1 FROM execution_attempts WHERE address=? AND state IN ('reserved','attempting','submitted','unknown')) AND NOT EXISTS(SELECT 1 FROM autonomous_account_locks WHERE account_address=?) ON CONFLICT DO NOTHING`).bind(proof.account,JSON.stringify(grant),JSON.stringify(proof),proof.observedAt,owner,grant.id,grant.state,proof.account,proof.account),
 db.prepare(`DELETE FROM autonomous_session_grants WHERE owner_ref=? AND id=? AND state=? AND EXISTS(SELECT 1 FROM autonomous_session_archive WHERE id=? AND owner_ref=?)`).bind(owner,grant.id,grant.state,grant.id,owner),
 ]);return results[0].meta.changes===1&&results[1].meta.changes===1;
}
export async function lastRetiredSession(db:D1Database,owner:string){return db.prepare('SELECT grant_json,retirement_json FROM autonomous_session_archive WHERE owner_ref=? ORDER BY retired_at DESC,id DESC LIMIT 1').bind(owner).first<{grant_json:string;retirement_json:string}>();}
