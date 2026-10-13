import fs from 'node:fs';
import path from 'node:path';
const keys=['ALCHEMY_API_KEY','ALPACA_CLIENT_SECRET','AUTH_SECRET','SESSION_SECRET'];
const secrets=keys.map(key=>process.env[key]).filter(value=>value && value.length>=16);
const files=[];function walk(dir){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);fs.statSync(file).isDirectory()?walk(file):files.push(file);}}
walk('dist/client');
const leaked=files.filter(file=>{const content=fs.readFileSync(file,'utf8');return secrets.some(secret=>content.includes(secret));});
console.log(JSON.stringify({assetsChecked:files.length,configuredSecretsChecked:secrets.length,exposedSecretCount:leaked.length}));
if(leaked.length)process.exitCode=1;
