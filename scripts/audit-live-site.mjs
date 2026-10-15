// Black-box production smoke checks. No real session, wallet or state changes.
import fs from 'node:fs';
const base='https://stocksteward.app',results=[];
async function check(path,expected,init={}){
 const start=Date.now();const r=await fetch(base+path,{...init,redirect:'manual',signal:AbortSignal.timeout(25000)});
 const body=await r.text();const ok=expected.includes(r.status);
 results.push({path,method:init.method??'GET',status:r.status,expected,ok,milliseconds:Date.now()-start,cache:r.headers.get('cache-control')});
 if(!ok)throw Error(`${path}: unexpected ${r.status}`);
 if(r.status===401&&(!body.includes('Sign in')&&!body.includes('sign in')))throw Error('Authentication failure was not clearly explained');
}
for(const path of ['/','/guide','/privacy','/terms'])await check(path,[200]);
await check('/workspace',[302,303,307]);
for(const path of ['/api/workspace/orders/live/status','/api/workspace/permission/install','/api/workspace/wallets/previous','/api/workspace/goal','/api/workspace/practice','/api/workspace/ownership']){
 await check(path,[401]);
 await check(path,[401],{headers:{'oai-authenticated-user-id':'audit-probe','oai-authenticated-user-email':'probe@example.invalid'}});
}
for(const path of ['/api/workspace/orders/live/prepare','/api/workspace/orders/live/receipt','/api/workspace/orders/live/reconcile'])await check(path,[401],{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({intentDigest:'0x'+'a'.repeat(64),hash:'0x'+'b'.repeat(64)})});
await check('/api/workspace/orders/live/status',[401],{headers:{Cookie:'steward_demo_session=invalid'}});
fs.writeFileSync('outputs/audit-live-site.json',JSON.stringify(results,null,2));
console.log(`${results.length} live route/auth checks passed`);
