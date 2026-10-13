import fs from 'node:fs';
const file=process.argv[2]??'outputs/audit-all-dependencies-final.json';
const audit=JSON.parse(fs.readFileSync(file,'utf8')); console.log(audit.metadata);
for(const [name,value] of Object.entries(audit.vulnerabilities??{}))console.log(name,value.severity,JSON.stringify(value.fixAvailable),value.nodes);
