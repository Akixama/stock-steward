import {randomBytes} from 'node:crypto';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {dirname} from 'node:path';import {spawnSync} from 'node:child_process';
// Provision encryption only. This generates no wallet key and grants no authority.
// Never rotate an existing remote key here: existing ciphertext must stay usable.
const config='dist/server/wrangler.json',cli='node_modules/wrangler/bin/wrangler.js',name='STEWARD_SIGNER_ENCRYPTION_KEY';
const list=spawnSync(process.execPath,[cli,'secret','list','--config',config],{encoding:'utf8',timeout:120000});
if(list.status!==0)throw Error('Remote secret inventory unavailable; no key was created or changed.');
let names;try{names=JSON.parse(list.stdout);}catch{throw Error('Remote secret inventory could not be verified.');}
if(!Array.isArray(names))throw Error('Remote secret inventory could not be verified.');
if(names.some(row=>row.name===name)){console.log('Existing session encryption retained.');process.exit(0);}
const path=fileURLToPath(new URL('../../../private-config/autonomous-signer-key.json',import.meta.url));let key;
try{key=JSON.parse(readFileSync(path,'utf8')).key;}catch(e){if(e.code!=='ENOENT')throw Error('Private encryption backup is invalid.');}
if(!key){key=randomBytes(32).toString('base64');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({purpose:'Stock Steward session encryption only',key},null,2),{flag:'wx',mode:0o600});}
if(typeof key!=='string'||Buffer.from(key,'base64').length!==32)throw Error('Private encryption backup is invalid.');
const put=spawnSync(process.execPath,[cli,'secret','put',name,'--config',config],{input:key+'\n',encoding:'utf8',timeout:120000});
if(put.status!==0)throw Error('Session encryption provisioning failed. Private backup retained for retry.');
console.log('Session encryption configured. Backup stays outside the application repository. No wallet key was created.');
