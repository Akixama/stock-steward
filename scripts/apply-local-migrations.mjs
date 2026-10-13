import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const migrations=readdirSync('drizzle').filter(name=>/^\d{4}.*\.sql$/.test(name)).sort();
if(!migrations.length)throw new Error('No SQL migrations found.');
for(const name of migrations){
  console.log(`Applying ${name}`);
  const result=spawnSync(process.execPath,[
    '--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js',
    'd1','execute','DB','--local','--config','dist/server/wrangler.json',
    '--persist-to','.wrangler/state','--file',`drizzle/${name}`,
  ],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status??1);
}
