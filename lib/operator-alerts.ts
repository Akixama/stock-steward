export type OperatorAlertConfig={enabled:boolean;url:string;secret:string};
export type OperatorAlert={id:string;kind:string;severity:string;message:string;created_at:string};

function configured(config:OperatorAlertConfig){
 if(!config.enabled||!/^([a-f0-9]{64})$/i.test(config.secret))return false;
 try{const u=new URL(config.url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&u.port===''&&/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)&&!/(^|\.)(localhost|local|internal)$/i.test(u.hostname);}catch{return false;}
}

export async function deliverOperatorAlert(alert:OperatorAlert,config:OperatorAlertConfig,fetcher:typeof fetch=fetch,now=new Date()){
 if(!configured(config))return false;
 // The receiver sees incident status only, never owner identity, balances,
 // session addresses, keys or signed transaction material.
 const body=JSON.stringify({schema:'stock-steward-operator-alert-v1',id:alert.id,kind:alert.kind,severity:alert.severity,message:alert.message,createdAt:alert.created_at});
 const timestamp=Math.floor(now.getTime()/1000).toString();
 const bytes=new Uint8Array(config.secret.match(/../g)!.map(pair=>parseInt(pair,16)));
 const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+body)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 try{const response=await fetcher(config.url,{method:'POST',headers:{'Content-Type':'application/json','X-Steward-Timestamp':timestamp,'X-Steward-Signature':signature,'Idempotency-Key':alert.id},body,redirect:'error',signal:AbortSignal.timeout(5000)});await response.body?.cancel();return response.ok;}catch{return false;}
}

export async function dispatchOperatorAlerts(db:D1Database,config:OperatorAlertConfig,fetcher:typeof fetch=fetch,now=new Date()){
 const summary={configured:configured(config),delivered:0,failed:0};
 if(!summary.configured)return summary;
 const at=now.toISOString();
 await db.prepare(`INSERT INTO autonomous_alert_deliveries(incident_id,next_attempt_at) SELECT id,? FROM autonomous_incidents WHERE severity IN ('warning','critical') ON CONFLICT DO NOTHING`).bind(at).run();
 await db.prepare(`UPDATE autonomous_alert_deliveries SET exhausted_at=? WHERE attempts>=5 AND delivered_at IS NULL AND exhausted_at IS NULL AND (lease_until IS NULL OR lease_until<=?)`).bind(at,at).run();
 const rows=(await db.prepare(`SELECT i.id,i.kind,i.severity,i.message,i.created_at,d.attempts FROM autonomous_alert_deliveries d JOIN autonomous_incidents i ON i.id=d.incident_id WHERE d.delivered_at IS NULL AND d.exhausted_at IS NULL AND d.next_attempt_at<=? AND (d.lease_until IS NULL OR d.lease_until<=?) ORDER BY d.next_attempt_at,d.incident_id LIMIT 3`).bind(at,at).all<OperatorAlert&{attempts:number}>()).results;
 for(const row of rows){
  const token=crypto.randomUUID();
  const claim=await db.prepare(`UPDATE autonomous_alert_deliveries SET lease_token=?,lease_until=?,attempts=attempts+1 WHERE incident_id=? AND attempts=? AND delivered_at IS NULL AND exhausted_at IS NULL AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)`).bind(token,new Date(now.getTime()+30000).toISOString(),row.id,row.attempts,at,at).run();
  if(claim.meta.changes!==1)continue;
  const sent=await deliverOperatorAlert(row,config,fetcher,now),attempts=row.attempts+1;
  const updated=await db.prepare(`UPDATE autonomous_alert_deliveries SET delivered_at=?,exhausted_at=?,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE incident_id=? AND lease_token=?`).bind(sent?at:null,!sent&&attempts>=5?at:null,new Date(now.getTime()+Math.min(3600000,60000*2**Math.min(attempts-1,6))).toISOString(),row.id,token).run();
  if(updated.meta.changes===1){if(sent)summary.delivered++;else summary.failed++;}
 }
 return summary;
}
