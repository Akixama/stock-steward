import {buildPushPayload,type PushSubscription} from '@block65/webcrypto-web-push';
import {checkAlerts} from '../db/price-alerts.ts';
import type {PriceAlert} from './price-alerts.ts';

export type DeviceSubscription=PushSubscription;
type DeviceRow={id:string;owner_ref:string;endpoint:string;p256dh:string;auth:string};
type DeliveryRow={id:string;owner_ref:string;alert_id:string;subscription_id:string;endpoint:string;p256dh:string;auth:string;symbol:string;direction:'above'|'below';price_cents:number;observed_price_cents:number};
const money=(cents:number)=>`$${(cents/100).toFixed(2)}`;
const encoded=/^[A-Za-z0-9_-]+$/;

export function validPushSubscription(value:unknown):value is DeviceSubscription{
 if(!value||typeof value!=='object')return false;
 const sub=value as Partial<DeviceSubscription>;
 if(typeof sub.endpoint!=='string'||sub.endpoint.length>2048||!sub.keys||typeof sub.keys.auth!=='string'||typeof sub.keys.p256dh!=='string')return false;
 if(!encoded.test(sub.keys.auth)||!encoded.test(sub.keys.p256dh)||sub.keys.auth.length>100||sub.keys.p256dh.length>200)return false;
 const publicBytes=Buffer.from(sub.keys.p256dh,'base64url'),authBytes=Buffer.from(sub.keys.auth,'base64url');
 if(publicBytes.length!==65||publicBytes[0]!==4||authBytes.length!==16)return false;
 try{
  const url=new URL(sub.endpoint);
  if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
  const host=url.hostname.toLowerCase();
  return host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host==='web.push.apple.com'||host.endsWith('.push.apple.com')||host==='wns.windows.com'||host.endsWith('.notify.windows.com');
 }catch{return false;}
}

async function deviceId(endpoint:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint));return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

export async function saveDevice(db:D1Database,owner:string,subscription:DeviceSubscription):Promise<void>{
 if(!validPushSubscription(subscription))throw Error('Unsupported push subscription.');
 const id=await deviceId(subscription.endpoint);
 const count=await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE owner_ref=?').bind(owner).first<{n:number}>();
 const exists=await db.prepare('SELECT owner_ref FROM push_subscriptions WHERE id=?').bind(id).first<{owner_ref:string}>();
 if(exists?.owner_ref!==owner&&(count?.n??0)>=8)throw Error('Remove an older device before adding another.');
 if(exists&&exists.owner_ref!==owner){
  await db.batch([db.prepare('DELETE FROM push_deliveries WHERE subscription_id=?').bind(id),db.prepare('UPDATE push_subscriptions SET owner_ref=?,p256dh=?,auth=?,created_at=? WHERE id=?').bind(owner,subscription.keys.p256dh,subscription.keys.auth,new Date().toISOString(),id)]);
  return;
 }
 await db.prepare('INSERT INTO push_subscriptions(id,owner_ref,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth').bind(id,owner,subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth,new Date().toISOString()).run();
}

export async function removeDevice(db:D1Database,owner:string,endpoint:string){
 const id=await deviceId(endpoint);
 await db.batch([db.prepare('DELETE FROM push_deliveries WHERE owner_ref=? AND subscription_id=?').bind(owner,id),db.prepare('DELETE FROM push_subscriptions WHERE owner_ref=? AND id=?').bind(owner,id)]);
}

export async function queueAlertPush(db:D1Database,owner:string,alerts:PriceAlert[]){
 if(!alerts.length)return;
 const devices=(await db.prepare('SELECT id,owner_ref,endpoint,p256dh,auth FROM push_subscriptions WHERE owner_ref=? LIMIT 8').bind(owner).all<DeviceRow>()).results??[];
 for(const alert of alerts)for(const device of devices){
  await db.prepare('INSERT OR IGNORE INTO push_deliveries(id,owner_ref,alert_id,subscription_id,status,attempts) VALUES(?,?,?,?,?,0)').bind(`${alert.id}:${device.id}`,owner,alert.id,device.id,'pending').run();
 }
}

export async function sendPendingPush(db:D1Database,keys:{publicKey:string;privateKey:string},limit=40,fetcher:typeof fetch=fetch):Promise<{sent:number;failed:number}>{
 if(!keys.publicKey||!keys.privateKey)return {sent:0,failed:0};
 const rows=(await db.prepare("SELECT d.id,d.owner_ref,d.alert_id,d.subscription_id,s.endpoint,s.p256dh,s.auth,a.symbol,a.direction,a.price_cents,a.observed_price_cents FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id AND s.owner_ref=d.owner_ref JOIN price_alerts a ON a.id=d.alert_id AND a.owner_ref=d.owner_ref WHERE (d.status='pending' OR (d.status='sending' AND d.claimed_at<?)) AND d.attempts<3 ORDER BY a.triggered_at ASC LIMIT ?").bind(new Date(Date.now()-10*60_000).toISOString(),limit).all<DeliveryRow>()).results??[];
 let sent=0,failed=0;
 for(const row of rows){
  const claim=await db.prepare("UPDATE push_deliveries SET status='sending',attempts=attempts+1,claimed_at=? WHERE id=? AND (status='pending' OR (status='sending' AND claimed_at<?))").bind(new Date().toISOString(),row.id,new Date(Date.now()-10*60_000).toISOString()).run();
  if(claim.meta.changes!==1)continue;
  try{
   const payload=await buildPushPayload({data:JSON.stringify({id:row.alert_id,title:`${row.symbol} price alert`,body:`${row.symbol} ${row.direction==='above'?'reached':'fell to'} ${money(row.observed_price_cents)}. Your target was ${money(row.price_cents)}.`,url:'https://stocksteward.app/workspace'}),options:{ttl:3600}}, {endpoint:row.endpoint,expirationTime:null,keys:{p256dh:row.p256dh,auth:row.auth}}, {subject:'https://stocksteward.app',publicKey:keys.publicKey,privateKey:keys.privateKey});
   const response=await fetcher(row.endpoint,{...payload,signal:AbortSignal.timeout(8000)});
   if(response.ok){await db.prepare("UPDATE push_deliveries SET status='sent',sent_at=? WHERE id=?").bind(new Date().toISOString(),row.id).run();sent++;}
   else if(response.status===404||response.status===410){await removeDevice(db,row.owner_ref,row.endpoint);failed++;}
   else{await db.prepare("UPDATE push_deliveries SET status='pending' WHERE id=?").bind(row.id).run();failed++;}
  }catch{await db.prepare("UPDATE push_deliveries SET status='pending' WHERE id=?").bind(row.id).run();failed++;}
 }
 return {sent,failed};
}

export async function checkBackgroundAlerts(db:D1Database,keys:{publicKey:string;privateKey:string}){
 const owners=(await db.prepare("SELECT DISTINCT a.owner_ref FROM price_alerts a JOIN push_subscriptions s ON s.owner_ref=a.owner_ref WHERE a.status='active' ORDER BY RANDOM() LIMIT 100").all<{owner_ref:string}>()).results??[];
 let checked=0,triggered=0;
 for(let start=0;start<owners.length;start+=8){
  const results=await Promise.allSettled(owners.slice(start,start+8).map(async ({owner_ref})=>{const result=await checkAlerts(db,owner_ref);await queueAlertPush(db,owner_ref,result.triggered);return result.triggered.length;}));
  for(const result of results)if(result.status==='fulfilled'){checked++;triggered+=result.value;}
 }
 const delivery=await sendPendingPush(db,keys);
 return {ownersChecked:checked,triggered,...delivery};
}
