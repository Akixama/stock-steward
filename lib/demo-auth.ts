// Demo sign-in identities for self-hosted previews where the ChatGPT platform headers do not
// exist. The cookie is HMAC-signed with a deployment secret; nothing else is ever trusted as
// identity. This path is inactive unless STEWARD_DEMO_AUTH is configured.
export type DemoIdentity={userId:string;displayName:string;expiresAt:number};
export const DEMO_COOKIE_NAME='steward_demo_session';
const VERSION='1';
const encoder=new TextEncoder();
const namePattern=/^[A-Za-z0-9 ._-]{1,32}$/;

const importKey=(secret:string)=>crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');

export async function issueDemoSession(secret:string,displayName:string,now=Date.now(),lifetimeMs=30*86400000):Promise<{cookieValue:string;identity:DemoIdentity}|null>{
 if(typeof secret!=='string'||secret.length<16)return null;
 const userId=crypto.randomUUID();
 const name=namePattern.test(displayName)?displayName:'Practice Demo';
 const expiresAt=now+lifetimeMs;
 const payload=[VERSION,userId,name,String(expiresAt)].join('|');
 const signature=hex(await crypto.subtle.sign('HMAC',await importKey(secret),encoder.encode(payload)));
 return {cookieValue:`${payload}|${signature}`,identity:{userId,displayName:name,expiresAt}};
}

export async function verifyDemoSession(secret:string,cookieValue:unknown,now=Date.now()):Promise<DemoIdentity|null>{
 if(typeof secret!=='string'||secret.length<16||typeof cookieValue!=='string'||cookieValue.length>256)return null;
 const parts=cookieValue.split('|');
 if(parts.length!==5||parts[0]!==VERSION)return null;
 const [userId,name,expiry,signature]=parts.slice(1);
 if(!/^[0-9a-f-]{36}$/.test(userId)||!namePattern.test(name)||!/^\d{1,15}$/.test(expiry)||!/^[0-9a-f]{64}$/.test(signature))return null;
 const expiresAt=Number(expiry);
 if(!Number.isSafeInteger(expiresAt)||expiresAt<=now)return null;
 const payload=[VERSION,userId,name,expiry].join('|');
 const valid=await crypto.subtle.verify('HMAC',await importKey(secret),Uint8Array.from(Buffer.from(signature,'hex')),encoder.encode(payload)).catch(()=>false);
 if(!valid)return null;
 return {userId,displayName:name,expiresAt};
}

export function demoSessionCookie(cookieValue:string,maxAgeSeconds=30*86400):string{
 return `${DEMO_COOKIE_NAME}=${cookieValue}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}
export function demoSessionClearedCookie():string{
 return `${DEMO_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
