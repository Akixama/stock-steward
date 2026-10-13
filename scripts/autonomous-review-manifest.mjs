import {mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const files=[];function walk(dir){for(const e of readdirSync(resolve(root,dir),{withFileTypes:true})){const name=dir+'/'+e.name;if(e.isDirectory())walk(name);else if(/\.(?:ts|tsx|js|jsx|mjs|sql|json|jsonc|css|html)$/.test(name)&&!name.endsWith('.test.ts')&&name!=='lib/autonomous-release-manifest.ts')files.push(name);}}
for(const dir of ['lib','db','app','drizzle','scripts','scheduler','build','components','hooks','public'])walk(dir);
for(const name of ['package.json','package-lock.json','cloudflare-env.d.ts','vite.config.ts'])files.push(name);
files.sort();const h=createHash('sha256');for(const f of files){h.update(f+'\0');h.update(readFileSync(resolve(root,f)));h.update('\0');}const digest='0x'+h.digest('hex');
writeFileSync(resolve(root,'lib/autonomous-release-manifest.ts'),`// Generated from ${files.length} application/configuration files before build.\nexport const AUTONOMOUS_SOURCE_DIGEST='${digest}';\n`);
mkdirSync(resolve(root,'outputs'),{recursive:true});
writeFileSync(resolve(root,'outputs/autonomous-review-manifest.json'),JSON.stringify({schema:'stock-steward-review-manifest-v1',digest,files},null,2));
console.log(`Autonomous review source digest: ${digest}`);
