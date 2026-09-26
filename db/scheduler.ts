import type {PricedObservation} from '../lib/chain-analysis.ts';
import type {AutonomyReceipt} from '../lib/autonomy.ts';
export type Schedule={owner_ref:string;address:string;interval_minutes:number;enabled:number;revision:number;next_due_at:string;lease_token:string|null;lease_until:string|null;last_attempt_at:string|null;last_success_at:string|null;failure_count:number;last_error:string|null;updated_at:string};
export type WorkerRun={id:string;address:string;revision:number;due_at:string;started_at:string;completed_at:string|null;status:string;attempts:number;observation_id:string|null;receipt_id:string|null;detail:string|null};
export type Claim={schedule:Schedule;token:string;runId:string};
export async function getSchedule(db:D1Database,owner:string){return db.prepare('SELECT * FROM autonomy_schedules WHERE owner_ref=?').bind(owner).first<Schedule>();}
export async function scheduleRuns(db:D1Database,owner:string){return (await db.prepare('SELECT id,address,revision,due_at,started_at,completed_at,status,attempts,observation_id,receipt_id,detail FROM autonomy_worker_runs WHERE owner_ref=? ORDER BY started_at DESC LIMIT 20').bind(owner).all<WorkerRun>()).results;}
export async function setSchedule(db:D1Database,owner:string,address:string,interval:number,expected:number,now=new Date()){
  if(!/^0x[0-9a-f]{40}$/i.test(address)||![15,30,60,240,1440].includes(interval)||!Number.isSafeInteger(expected)||expected<0)throw new Error('Invalid schedule');
  const iso=now.toISOString();
  const result=await db.prepare(`INSERT INTO autonomy_schedules(owner_ref,address,interval_minutes,enabled,revision,next_due_at,failure_count,updated_at)
    SELECT ?,?,?,1,1,?,0,? WHERE ?=0 OR EXISTS(SELECT 1 FROM autonomy_schedules WHERE owner_ref=? AND revision=?)
    ON CONFLICT(owner_ref) DO UPDATE SET address=excluded.address,interval_minutes=excluded.interval_minutes,enabled=1,revision=autonomy_schedules.revision+1,
    next_due_at=excluded.next_due_at,lease_token=NULL,lease_until=NULL,last_attempt_at=NULL,last_success_at=NULL,failure_count=0,last_error=NULL,updated_at=excluded.updated_at
    WHERE autonomy_schedules.revision=?`).bind(owner,address.toLowerCase(),interval,iso,iso,expected,owner,expected,expected).run();
  return result.meta.changes===1;
}
export async function controlSchedule(db:D1Database,owner:string,expected:number,enabled:boolean,now=new Date()){
  const statements=[db.prepare(`UPDATE autonomy_schedules SET enabled=?,revision=revision+1,lease_token=NULL,lease_until=NULL,
    next_due_at=?,failure_count=CASE WHEN ?=1 THEN 0 ELSE failure_count END,last_error=CASE WHEN ?=1 THEN NULL ELSE last_error END,updated_at=? WHERE owner_ref=? AND revision=?`)
    .bind(enabled?1:0,now.toISOString(),enabled?1:0,enabled?1:0,now.toISOString(),owner,expected),
    db.prepare(`UPDATE autonomy_worker_runs SET status='canceled',completed_at=?,detail='Monitoring controls changed; prior attempt is fenced.' WHERE owner_ref=? AND revision=? AND status='running'
      AND EXISTS(SELECT 1 FROM autonomy_schedules WHERE owner_ref=? AND revision=?)`).bind(now.toISOString(),owner,expected,owner,expected+1)];
  const result=await db.batch(statements);return result[0].meta.changes===1;
}
export async function claimSchedule(db:D1Database,schedule:Schedule,now=new Date()):Promise<Claim|null>{
  const token=crypto.randomUUID(),iso=now.toISOString(),lease=new Date(now.getTime()+10*60000).toISOString();
  const result=await db.prepare(`UPDATE autonomy_schedules SET lease_token=?,lease_until=?,last_attempt_at=? WHERE owner_ref=? AND revision=? AND enabled=1 AND next_due_at=? AND next_due_at<=? AND (lease_until IS NULL OR lease_until<=?)`)
    .bind(token,lease,iso,schedule.owner_ref,schedule.revision,schedule.next_due_at,iso,iso).run();if(result.meta.changes!==1)return null;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([schedule.owner_ref,schedule.revision,schedule.next_due_at])));
  const runId=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  await db.prepare(`INSERT INTO autonomy_worker_runs(id,owner_ref,address,revision,due_at,started_at,status,attempt_token,attempts) VALUES(?,?,?,?,?,?,'running',?,1)
    ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at,status='running',attempt_token=excluded.attempt_token,attempts=autonomy_worker_runs.attempts+1,completed_at=NULL`)
    .bind(runId,schedule.owner_ref,schedule.address,schedule.revision,schedule.next_due_at,iso,token).run();return {schedule,token,runId};
}
export async function claimCurrent(db:D1Database,claim:Claim){
  return !!await db.prepare('SELECT 1 FROM autonomy_schedules WHERE owner_ref=? AND revision=? AND enabled=1 AND lease_token=?').bind(claim.schedule.owner_ref,claim.schedule.revision,claim.token).first();
}
export async function finishSchedule(db:D1Database,claim:Claim,observation:PricedObservation|null,receipt:AutonomyReceipt|null,now=new Date()){
  const {schedule:s,token,runId}=claim,iso=now.toISOString(),failed=!observation;
  const next=new Date(now.getTime()+s.interval_minutes*60000).toISOString();
  const guard='EXISTS(SELECT 1 FROM autonomy_schedules WHERE owner_ref=? AND revision=? AND enabled=1 AND lease_token=?)';
  const args=[s.owner_ref,s.revision,token];const statements:D1PreparedStatement[]=[];
  if(observation)statements.push(db.prepare(`INSERT OR IGNORE INTO chain_observations(id,owner_ref,address,record_json,created_at) SELECT ?,?,?,?,? WHERE ${guard}`)
    .bind(observation.id,s.owner_ref,s.address,JSON.stringify(observation),observation.observedAt,...args));
  if(receipt)statements.push(db.prepare(`INSERT OR IGNORE INTO autonomy_runs(id,owner_ref,address,receipt_json,created_at) SELECT ?,?,?,?,? WHERE ${guard}`)
    .bind(receipt.id,s.owner_ref,s.address,JSON.stringify(receipt),receipt.createdAt,...args));
  statements.push(db.prepare(`UPDATE autonomy_worker_runs SET completed_at=?,status=CASE WHEN ${guard} THEN ? ELSE 'canceled' END,
    observation_id=CASE WHEN ${guard} THEN ? ELSE NULL END,receipt_id=CASE WHEN ${guard} THEN ? ELSE NULL END,
    detail=CASE WHEN ${guard} THEN ? ELSE 'Schedule changed or paused during this run. Result was discarded.' END WHERE id=? AND attempt_token=? AND status='running'`)
    .bind(iso,...args,failed?'error':'observed',...args,observation?.id??null,...args,receipt?.id??null,...args,
      failed?'Observation unavailable; no holdings or trading conclusion was made.':observation!.failures?'Partial balance coverage. Trading remains blocked.':'Read-only observation saved. Trading remains blocked.',runId,token));
  statements.push(db.prepare(`UPDATE autonomy_schedules SET next_due_at=?,lease_token=NULL,lease_until=NULL,last_success_at=CASE WHEN ?=0 THEN ? ELSE last_success_at END,
    failure_count=CASE WHEN ?=1 THEN failure_count+1 ELSE 0 END,last_error=CASE WHEN ?=1 THEN 'Observation failed. Three consecutive failures pause monitoring.' ELSE NULL END,
    enabled=CASE WHEN ?=1 AND failure_count>=2 THEN 0 ELSE enabled END,updated_at=? WHERE owner_ref=? AND revision=? AND enabled=1 AND lease_token=?`)
    .bind(next,failed?1:0,iso,failed?1:0,failed?1:0,failed?1:0,iso,...args));
  await db.batch(statements);
  return db.prepare('SELECT status FROM autonomy_worker_runs WHERE id=? AND attempt_token=?').bind(runId,token).first<{status:string}>();
}
export async function dueSchedules(db:D1Database,now=new Date()){
  return (await db.prepare('SELECT * FROM autonomy_schedules WHERE enabled=1 AND next_due_at<=? AND (lease_until IS NULL OR lease_until<=?) ORDER BY next_due_at LIMIT 2')
    .bind(now.toISOString(),now.toISOString()).all<Schedule>()).results;
}
export async function claimWorker(db:D1Database,now=new Date()){
  const token=crypto.randomUUID(),iso=now.toISOString(),lease=new Date(now.getTime()+10*60000).toISOString();
  const result=await db.prepare(`INSERT INTO autonomy_worker_health(id,lease_until,lease_token,last_started_at) VALUES('monitor',?,?,?)
    ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until,lease_token=excluded.lease_token,last_started_at=excluded.last_started_at
    WHERE autonomy_worker_health.lease_until IS NULL OR autonomy_worker_health.lease_until<=?`).bind(lease,token,iso,iso).run();
  return result.meta.changes===1?token:null;
}
export async function finishWorker(db:D1Database,token:string,summary:unknown){await db.prepare("UPDATE autonomy_worker_health SET lease_token=NULL,lease_until=NULL,last_completed_at=?,last_summary=? WHERE id='monitor' AND lease_token=?").bind(new Date().toISOString(),JSON.stringify(summary),token).run();}
