import {buildPushPayload} from '@block65/webcrypto-web-push';
import type {AutomaticStageEvent} from '../db/automatic-stage-events.ts';

type Device={id:string;owner_ref:string;endpoint:string;p256dh:string;auth:string};
type Delivery=AutomaticStageEvent&Device&{attempts:number};

export async function queueAutomaticPush(db:D1Database,event:AutomaticStageEvent):Promise<void>{
  await db.prepare(`INSERT OR IGNORE INTO automatic_stage_deliveries(event_id,subscription_id,status,attempts)
    SELECT ?,id,'pending',0 FROM push_subscriptions WHERE owner_ref=?`).bind(event.id,event.owner_ref).run();
}

export async function sendAutomaticPush(db:D1Database,keys:{publicKey:string;privateKey:string},fetcher:typeof fetch=fetch):Promise<{sent:number;failed:number}>{
  if(!keys.publicKey||!keys.privateKey)return {sent:0,failed:0};
  const stale=new Date(Date.now()-10*60_000).toISOString();
  const rows=(await db.prepare(`SELECT e.*,s.id AS subscription_id,s.endpoint,s.p256dh,s.auth,d.attempts
    FROM automatic_stage_deliveries d JOIN automatic_stage_events e ON e.id=d.event_id
    JOIN push_subscriptions s ON s.id=d.subscription_id AND s.owner_ref=e.owner_ref
    WHERE d.attempts<3 AND (d.status='pending' OR (d.status='sending' AND d.claimed_at<?))
    ORDER BY e.created_at LIMIT 20`).bind(stale).all<Delivery&{subscription_id:string}>()).results;
  let sent=0,failed=0;
  for(const row of rows){
    const now=new Date().toISOString();
    const claim=await db.prepare(`UPDATE automatic_stage_deliveries SET status='sending',attempts=attempts+1,claimed_at=?
      WHERE event_id=? AND subscription_id=? AND attempts=? AND (status='pending' OR (status='sending' AND claimed_at<?))`)
      .bind(now,row.id,row.subscription_id,row.attempts,stale).run();
    if(claim.meta.changes!==1)continue;
    if(row.kind==='proposal'&&(row.status!=='proposed'||Date.parse(row.expires_at)<=Date.now()))continue;
    try{
      const title=row.kind==='proposal'?'Buy idea to review':'Automatic buy update';
      const body=row.kind==='proposal'
        ?`${row.symbol}: your rule suggests about $${(row.amount_cents/100).toFixed(2)}. Open Stock Steward for a fresh quote and sign only if you agree.`
        :`${row.symbol}: ${row.status}. ${row.detail}`;
      const payload=await buildPushPayload({data:JSON.stringify({id:row.id,title,body,url:row.kind==='proposal'?'https://stocksteward.app/workspace?view=alerts':'https://stocksteward.app/workspace?view=strategy'}),options:{ttl:row.kind==='proposal'?900:3600}},
        {endpoint:row.endpoint,expirationTime:null,keys:{p256dh:row.p256dh,auth:row.auth}},
        {subject:'https://stocksteward.app',publicKey:keys.publicKey,privateKey:keys.privateKey});
      const response=await fetcher(row.endpoint,{...payload,signal:AbortSignal.timeout(8000)});
      if(response.ok){await db.prepare("UPDATE automatic_stage_deliveries SET status='sent',sent_at=? WHERE event_id=? AND subscription_id=?").bind(new Date().toISOString(),row.id,row.subscription_id).run();sent++;}
      else {await db.prepare("UPDATE automatic_stage_deliveries SET status='pending' WHERE event_id=? AND subscription_id=?").bind(row.id,row.subscription_id).run();failed++;}
    }catch{await db.prepare("UPDATE automatic_stage_deliveries SET status='pending' WHERE event_id=? AND subscription_id=?").bind(row.id,row.subscription_id).run();failed++;}
  }
  return {sent,failed};
}
