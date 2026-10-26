import type {AgentDecision,AgentSettings} from '../lib/ai-agent.ts';
export type AgentRow={owner_ref:string;settings_json:string;enabled:number;next_run_at:string;updated_at:string};
export async function getAgent(db:D1Database,owner:string){return db.prepare('SELECT * FROM ai_agents WHERE owner_ref=?').bind(owner).first<AgentRow>();}
export async function saveAgent(db:D1Database,owner:string,settings:AgentSettings,enabled:boolean,now=new Date()){
 // Turning the agent on makes it due right away; the next minute check runs it.
 await db.prepare('INSERT INTO ai_agents(owner_ref,settings_json,enabled,next_run_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_ref) DO UPDATE SET settings_json=excluded.settings_json,enabled=excluded.enabled,next_run_at=excluded.next_run_at,updated_at=excluded.updated_at')
  .bind(owner,JSON.stringify(settings),enabled?1:0,now.toISOString(),now.toISOString()).run();
}
export async function dueAgents(db:D1Database,now=new Date()){return (await db.prepare('SELECT * FROM ai_agents WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at LIMIT 5').bind(now.toISOString()).all<AgentRow>()).results??[];}
// Compare-and-set on next_run_at: two overlapping ticks never both decide.
export async function claimAgent(db:D1Database,row:AgentRow,intervalMinutes:number,now=new Date()){
 return (await db.prepare('UPDATE ai_agents SET next_run_at=? WHERE owner_ref=? AND enabled=1 AND next_run_at=?').bind(new Date(now.getTime()+intervalMinutes*60_000).toISOString(),row.owner_ref,row.next_run_at).run()).meta.changes===1;
}
export async function logAgentDecision(db:D1Database,owner:string,d:AgentDecision){
 await db.prepare('INSERT OR IGNORE INTO ai_agent_log(id,owner_ref,decision_json,created_at) VALUES(?,?,?,?)').bind(`${owner}:${d.at}`,owner,JSON.stringify(d),d.at).run();
}
export async function agentLog(db:D1Database,owner:string,limit=20):Promise<AgentDecision[]>{
 const rows=(await db.prepare('SELECT decision_json FROM ai_agent_log WHERE owner_ref=? ORDER BY created_at DESC LIMIT ?').bind(owner,limit).all<{decision_json:string}>()).results??[];
 return rows.flatMap(r=>{try{return [JSON.parse(r.decision_json) as AgentDecision];}catch{return [];}});
}
