export async function claimAIRequest(db:D1Database,owner:string,now=Date.now()){
 const day=new Date(now).toISOString().slice(0,10);
 const query='INSERT INTO strategy_ai_usage (scope,day,requests,next_at) VALUES (?,?,1,?) ON CONFLICT(scope,day) DO UPDATE SET requests=requests+1,next_at=excluded.next_at WHERE requests < ? AND next_at <= ?';
 const result=await db.batch([db.prepare(query).bind('global',day,0,50,now),db.prepare(query).bind('user:'+owner,day,now+15000,10,now)]);
 return result.every(r=>r.meta.changes===1);
}
