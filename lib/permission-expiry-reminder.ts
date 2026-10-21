import {buildPushPayload} from '@block65/webcrypto-web-push';
import {RENEW_NOTICE_SECONDS} from './permission-window.ts';

type Delivery={owner_ref:string;safe:string;expires_at:number;subscription_id:string;endpoint:string;p256dh:string;auth:string;attempts:number};
export function reminderDue(expiry:number,nowSeconds:number){return Number.isSafeInteger(expiry)&&expiry>nowSeconds&&expiry-nowSeconds<=RENEW_NOTICE_SECONDS;}

export async function queuePermissionExpiryReminders(db:D1Database,now=Math.floor(Date.now()/1000)){
  await db.prepare(`INSERT OR IGNORE INTO permission_expiry_deliveries(owner_ref,safe,expires_at,subscription_id,status)
    SELECT a.owner_ref,a.safe,a.expires_at,s.id,'pending' FROM active_modules a
    JOIN mandates m ON m.owner_ref=a.owner_ref AND m.version=a.mandate_version
    JOIN push_subscriptions s ON s.owner_ref=a.owner_ref
    WHERE m.version=(SELECT MAX(version) FROM mandates WHERE owner_ref=a.owner_ref)
      AND a.expires_at>? AND a.expires_at<=? AND NOT EXISTS(
      SELECT 1 FROM permission_maintenance_attempts p WHERE p.owner_ref=a.owner_ref AND p.safe=a.safe
        AND p.kind='revoke' AND p.state='confirmed' AND p.updated_at>a.verified_at)
    LIMIT 100`).bind(now,now+RENEW_NOTICE_SECONDS).run();
}

export async function sendPermissionExpiryReminders(db:D1Database,keys:{publicKey:string;privateKey:string},fetcher:typeof fetch=fetch){
  if(!keys.publicKey||!keys.privateKey)return {sent:0,failed:0};
  const now=Math.floor(Date.now()/1000),stale=new Date(Date.now()-10*60_000).toISOString();
  await queuePermissionExpiryReminders(db,now);
  const rows=(await db.prepare(`SELECT d.*,s.endpoint,s.p256dh,s.auth FROM permission_expiry_deliveries d
    JOIN push_subscriptions s ON s.id=d.subscription_id AND s.owner_ref=d.owner_ref
    JOIN active_modules a ON a.owner_ref=d.owner_ref AND a.safe=d.safe AND a.expires_at=d.expires_at
    WHERE d.attempts<3 AND d.expires_at>? AND (d.status='pending' OR (d.status='sending' AND d.claimed_at<?))
    ORDER BY d.expires_at LIMIT 25`).bind(now,stale).all<Delivery>()).results;
  let sent=0,failed=0;
  for(const row of rows){
    const claim=await db.prepare(`UPDATE permission_expiry_deliveries SET status='sending',attempts=attempts+1,claimed_at=?
      WHERE owner_ref=? AND safe=? AND expires_at=? AND subscription_id=? AND attempts=?
      AND (status='pending' OR (status='sending' AND claimed_at<?))`)
      .bind(new Date().toISOString(),row.owner_ref,row.safe,row.expires_at,row.subscription_id,row.attempts,stale).run();
    if(claim.meta.changes!==1)continue;
    try{
      const when=new Date(row.expires_at*1000).toISOString().replace('.000Z',' UTC');
      const payload=await buildPushPayload({data:JSON.stringify({id:`permission:${row.safe}:${row.expires_at}`,title:'Buying approval expires soon',body:`Your Steward wallet approval window ends ${when}. Open Stock Steward to check it. Renewal requires your wallet.`,url:'https://stocksteward.app/workspace'}),options:{ttl:3600}},
        {endpoint:row.endpoint,expirationTime:null,keys:{p256dh:row.p256dh,auth:row.auth}},
        {subject:'https://stocksteward.app',publicKey:keys.publicKey,privateKey:keys.privateKey});
      const response=await fetcher(row.endpoint,{...payload,signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw Error('Push service unavailable');
      await db.prepare("UPDATE permission_expiry_deliveries SET status='sent',sent_at=? WHERE owner_ref=? AND safe=? AND expires_at=? AND subscription_id=?")
        .bind(new Date().toISOString(),row.owner_ref,row.safe,row.expires_at,row.subscription_id).run();sent++;
    }catch{await db.prepare("UPDATE permission_expiry_deliveries SET status='pending' WHERE owner_ref=? AND safe=? AND expires_at=? AND subscription_id=?")
        .bind(row.owner_ref,row.safe,row.expires_at,row.subscription_id).run();failed++;}
  }
  return {sent,failed};
}
