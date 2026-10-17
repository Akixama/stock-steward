import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const output=join(process.cwd(),'public','stock-logos');
const indexFile=join(output,'index.json');
const source='https://www.allinvestview.com/api/logo-search/?q=';
const cdn='https://cdn.tickerlogos.com/';
const pause=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const skipWords=new Set(['inc','corp','corporation','company','companies','holdings','holding','class','common','stock','shares','limited','group','fund','trust','technologies','technology','etf','the']);
// Current company domains for symbols where the search index is missing or stale.
const domainOverrides={AUR:'aurora.tech',CRDO:'credosemi.com',P:'everpuredata.com',XOM:'exxonmobil.com',FIG:'figma.com',SPMO:'invesco.com',IONQ:'ionq.com',IREN:'iren.com',JOBY:'jobyaviation.com',KSS:'kohls.com',NNE:'nanonuclearenergy.com',NVTS:'navitassemi.com',NU:'nu.com',PR:'permianres.com',POET:'poet-technologies.com',RDW:'redwirespace.com',RGTI:'rigetti.com',RIVN:'rivian.com',RKLB:'rocketlabcorp.com',SOUN:'soundhound.com',SPCX:'spacex.com',MSTR:'strategy.com',WULF:'terawulf.com',SMH:'vaneck.com',XNDU:'xanadu.ai'};
const words=(name)=>new Set(name.toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ').filter(word=>word.length>=3&&!skipWords.has(word)));
const matches=(expected,actual)=>{
 const expectedWords=words(expected),actualWords=words(actual);
 const initials=[...actualWords].map(word=>word[0]).join('');
 return [...expectedWords].some(word=>actualWords.has(word)||word===initials);
};

async function get(url){
 for(let attempt=0;attempt<4;attempt++){
  const response=await fetch(url,{signal:AbortSignal.timeout(15_000)});
  if(response.status===429){await pause(12_000*(attempt+1));continue;}
  return response;
 }
 throw new Error(`Rate limit persisted for ${url}`);
}

await mkdir(output,{recursive:true});
const catalogResponse=await get('https://stocksteward.app/api/chart?symbol=AAPL');
if(!catalogResponse.ok)throw new Error(`Catalog request failed: ${catalogResponse.status}`);
const {catalog}=await catalogResponse.json();
if(!Array.isArray(catalog))throw new Error('Catalog response has no stock list.');
let existing={};
try{existing=JSON.parse(await readFile(indexFile,'utf8'));}catch{/* First sync. */}
const index={...existing};
let found=0,skipped=0;
for(const [position,stock] of catalog.entries()){
 if(!/^[A-Z][A-Z0-9.]{0,7}$/.test(stock.symbol))continue;
 if(index[stock.symbol])continue;
 await pause(1100);
 let domain=domainOverrides[stock.symbol];
 if(!domain){
  const result=await get(`${source}${encodeURIComponent(stock.symbol)}`);
  if(!result.ok){skipped++;continue;}
  const body=await result.json();
  const exact=(body.results??[]).find(item=>item.symbol===stock.symbol&&typeof item.website==='string'&&matches(stock.name,item.name??''));
  if(!exact){skipped++;continue;}
  try{domain=new URL(exact.website.startsWith('http')?exact.website:`https://${exact.website}`).hostname.replace(/^www\./,'').toLowerCase();}catch{skipped++;continue;}
 }
 if(!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)){skipped++;continue;}
 let logo=await get(`${cdn}${domain}`);
 let type=logo.headers.get('content-type')??'';
 if(!logo.ok||!type.startsWith('image/')){
  // A verified company's own favicon is preferable to a guessed logo.
  try{logo=await get(`https://${domain}/favicon.ico`);type=logo.headers.get('content-type')??'';}catch{/* Try the icon linked from the home page. */}
 }
 if(!logo.ok||!type.startsWith('image/')){
  try{
   const home=await get(`https://${domain}`);
   const html=await home.text();
   const tags=[...html.matchAll(/<link\b[^>]*>/gi)].map(match=>match[0]);
   const paths=tags.filter(tag=>/\brel\s*=\s*["'][^"']*icon/i.test(tag))
    .map(tag=>tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]).filter(Boolean);
   paths.push('/apple-touch-icon.png');
   for(const path of paths){
    const url=new URL(path,home.url);
    if(url.hostname!==domain&&url.hostname!==`www.${domain}`&&!url.hostname.endsWith(`.${domain}`))continue;
    const candidate=await get(url.toString());
    const candidateType=candidate.headers.get('content-type')??'';
    if(candidate.ok&&/image\/(png|webp|jpeg|x-icon|vnd\.microsoft\.icon)/i.test(candidateType)){logo=candidate;type=candidateType;break;}
   }
  }catch{/* Keep the symbol if the company site does not expose an image. */}
 }
 if((!logo.ok||!/image\/(png|webp|jpeg|x-icon|vnd\.microsoft\.icon)/i.test(type))&&domainOverrides[stock.symbol]){
  try{logo=await get(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);type=logo.headers.get('content-type')??'';}catch{/* Keep the symbol if no icon is available. */}
 }
 if(!logo.ok||!type.startsWith('image/')){skipped++;continue;}
 let bytes=Buffer.from(await logo.arrayBuffer());
 if(bytes.length<100&&domainOverrides[stock.symbol]){
  const fallback=await get(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
  if(fallback.ok){logo=fallback;type=fallback.headers.get('content-type')??'';bytes=Buffer.from(await fallback.arrayBuffer());}
 }
 if(bytes.length<100||bytes.length>500_000){skipped++;continue;}
 const extension=type.includes('png')?'png':type.includes('webp')?'webp':type.includes('jpeg')?'jpg':type.includes('icon')?'ico':null;
 if(!extension){skipped++;continue;}
 await writeFile(join(output,`${stock.symbol}.${extension}`),bytes);
 index[stock.symbol]=extension;
 found++;
 if(position%20===0)console.log(`${position+1}/${catalog.length}: ${found} logos added, ${skipped} without a verified match`);
}
await writeFile(indexFile,`${JSON.stringify(Object.fromEntries(Object.entries(index).sort()),null,2)}\n`);
console.log(`Finished: ${Object.keys(index).length}/${catalog.length} logos, ${skipped} unmatched on this run.`);
