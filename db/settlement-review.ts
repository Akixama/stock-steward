import type {RouteEvidence} from '../lib/chain-route.ts';
import {reviewSettlement,type SpendRow} from '../lib/settlement-review.ts';
export async function settlementReview(db:D1Database,owner:string,route:RouteEvidence){
 const rows=await db.prepare(`SELECT s.intent_id,s.amount_cents,s.state,s.execution_day,a.plan_json FROM autonomy_spends s LEFT JOIN execution_attempts a ON a.owner_ref=s.owner_ref AND a.address=s.address AND a.id=s.intent_id WHERE s.owner_ref=? AND s.address=? AND (s.state IN ('reserved','submitted','unknown') OR (s.state='confirmed' AND s.execution_day=?)) ORDER BY s.intent_id LIMIT 501`).bind(owner,route.address.toLowerCase(),new Date().toISOString().slice(0,10)).all<SpendRow>();
 return reviewSettlement(route,rows.results);
}
