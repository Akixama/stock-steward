import {generateKeyPairSync} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';

// Run once for a new installation. Rotating these keys requires renewing browser subscriptions.
const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
const publicJwk=pair.publicKey.export({format:'jwk'});
const privateJwk=pair.privateKey.export({format:'jwk'});
const publicKey=Buffer.concat([Buffer.from([4]),Buffer.from(publicJwk.x,'base64url'),Buffer.from(publicJwk.y,'base64url')]).toString('base64url');
const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');

async function put(name,value){
 await new Promise((resolveDone,reject)=>{
  const child=spawn(process.execPath,[wrangler,'secret','put',name,'--name','stock-steward'],{stdio:['pipe','ignore','pipe']});
  let error='';child.stderr.on('data',chunk=>{error+=chunk.toString().slice(0,1000);});
  child.on('error',reject);
  child.on('close',code=>code===0?resolveDone():reject(new Error(`${name} could not be stored: ${error.slice(0,200)}`)));
  child.stdin.end(value+'\n');
 });
}

await put('STEWARD_VAPID_PRIVATE_KEY',privateJwk.d);
await put('STEWARD_VAPID_PUBLIC_KEY',publicKey);
console.log('Web Push keys stored in Cloudflare. Existing browser subscriptions would need renewal if keys are changed.');
