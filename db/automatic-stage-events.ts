export type AutomaticStageEvent={id:string;owner_ref:string;run_id:string;kind:'proposal'|'auto_started'|'auto_action';status:'proposed'|'checking'|'blocked'|'submitted'|'unknown';symbol:string;amount_cents:number;detail:string;transaction_hash:string|null;created_at:string;expires_at:string};

export async function saveAutomaticEvent(db:D1Database,event:AutomaticStageEvent):Promise<boolean>{
  if(!/^0x[0-9a-f]{64}:(proposal|auto_started|auto_action)$/i.test(event.id)||event.id!==`${event.run_id}:${event.kind}`||!/^0x[0-9a-f]{64}$/i.test(event.run_id)||!/^([A-Z][A-Z0-9.]{0,7})$/.test(event.symbol)||!Number.isSafeInteger(event.amount_cents)||event.amount_cents<1||event.amount_cents>(event.kind==='proposal'?1000:500)||event.detail.length>500)throw Error('Invalid automatic event.');
  if(event.transaction_hash&&!/^0x[0-9a-f]{64}$/i.test(event.transaction_hash))throw Error('Invalid transaction hash.');
  const result=await db.prepare('INSERT OR IGNORE INTO automatic_stage_events(id,owner_ref,run_id,kind,status,symbol,amount_cents,detail,transaction_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .bind(event.id,event.owner_ref,event.run_id,event.kind,event.status,event.symbol,event.amount_cents,event.detail,event.transaction_hash,event.created_at,event.expires_at).run();
  return result.meta.changes===1;
}

// One live idea per running rule revision. The single INSERT statement makes
// the duplicate check and write atomic even when two scheduled checks overlap.
// It also requires the plan to still be running at the checked revision:
// pausing bumps the revision, so a check that finishes after a pause saves nothing.
export async function saveRuleProposal(db:D1Database,event:AutomaticStageEvent,revision:number,now=new Date(),ruleId='main'):Promise<boolean>{
  if(event.kind!=='proposal'||!Number.isSafeInteger(revision)||revision<1)throw Error('Invalid rule proposal.');
  if(!/^0x[0-9a-f]{64}:proposal$/i.test(event.id)||event.id!==`${event.run_id}:proposal`||!/^[A-Z][A-Z0-9.]{0,7}$/.test(event.symbol)||!Number.isSafeInteger(event.amount_cents)||event.amount_cents<1||event.amount_cents>100000)throw Error('Invalid rule proposal.');
  const result=await db.prepare(`INSERT OR IGNORE INTO automatic_stage_events(id,owner_ref,run_id,kind,status,symbol,amount_cents,detail,transaction_hash,created_at,expires_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM autonomous_shadow_plans plan WHERE plan.owner_ref=? AND plan.rule_id=? AND plan.revision=? AND plan.enabled=1
    ) AND NOT EXISTS (
      SELECT 1 FROM automatic_stage_events old JOIN autonomous_shadow_runs run ON run.id=old.run_id
      WHERE old.owner_ref=? AND old.kind='proposal' AND old.status='proposed' AND old.expires_at>?
        AND run.rule_id=? AND run.revision=? AND old.symbol=? AND old.amount_cents=?
    )`).bind(event.id,event.owner_ref,event.run_id,event.kind,event.status,event.symbol,event.amount_cents,event.detail,event.transaction_hash,event.created_at,event.expires_at,event.owner_ref,ruleId,revision,event.owner_ref,now.toISOString(),ruleId,revision,event.symbol,event.amount_cents).run();
  return result.meta.changes===1;
}

export async function automaticEvents(db:D1Database,owner:string):Promise<AutomaticStageEvent[]>{
  return (await db.prepare('SELECT * FROM automatic_stage_events WHERE owner_ref=? ORDER BY created_at DESC LIMIT 30').bind(owner).all<AutomaticStageEvent>()).results;
}

// Atomic one-use opening of a proposal. This authorizes no order: it only
// reveals the existing manual Buy flow, which obtains a fresh quote/signature.
export async function claimProposalReview(db:D1Database,owner:string,id:string,now=new Date()){
  if(!/^0x[0-9a-f]{64}:proposal$/i.test(id))return null;
  const result=await db.prepare("UPDATE automatic_stage_events SET status='checking' WHERE id=? AND owner_ref=? AND kind='proposal' AND status='proposed' AND expires_at>?")
    .bind(id,owner,now.toISOString()).run();
  if(result.meta.changes!==1)return null;
  return db.prepare("SELECT symbol,amount_cents,expires_at FROM automatic_stage_events WHERE id=? AND owner_ref=? AND status='checking'")
    .bind(id,owner).first<{symbol:string;amount_cents:number;expires_at:string}>();
}
