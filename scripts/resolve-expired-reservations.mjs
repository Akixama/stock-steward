// One-off, owner-approved recovery of legacy reservations. No wallet calls or
// transaction submission. Unknown payments or incomplete history stop recovery.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {decodeFunctionData,parseAbi,toHex} from 'viem';
import {validateRouterCandidate} from '../lib/router-candidate.ts';
import {rolesOperation} from '../lib/roles-operation.ts';
const safe='0x123b44550990c3d61c9a7954ccaf820040a145eb';
const owner='0xdc7f175bca1c29a77286a52c857e7fef12f3f662';
function query(sql){const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','stock-steward-demo-db','--remote','--command',sql,'--json'],{encoding:'utf8'});if(result.status!==0)throw Error('Database operation failed');const body=JSON.parse(result.stdout);if(!body.every(row=>row.success))throw Error('Database operation failed');return body;}
const rows=query(`SELECT owner_ref,intent_digest,state,transaction_hash,plan_json FROM execution_attempts WHERE address='${safe}'`)[0].results;
const pending=rows.filter(row=>row.state==='reserved'&&row.transaction_hash===null);
if(pending.length!==2)throw Error('Unexpected reservation count; recovery stopped');
const plans=pending.map(row=>JSON.parse(row.plan_json));
const apiKey=process.env.ALCHEMY_API_KEY;if(!apiKey)throw Error('Archive provider is not configured');
let serial=0;
async function rpc(method,params){const endpoint=method==='eth_getLogs'?'https://rpc.mainnet.chain.robinhood.com/':`https://robinhood-mainnet.g.alchemy.com/v2/${apiKey}`;const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++serial,method,params}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error(`Chain read unavailable: ${method}, HTTP ${response.status}`);const body=await response.json();if(body.error||body.result===undefined)throw Error(`Chain evidence unavailable: ${method}, code ${body.error?.code??'missing'}`);return body.result;}
const final=await rpc('eth_getBlockByNumber',['finalized',false]);
if(!final?.hash||!final.number||!final.timestamp)throw Error('Finalized checkpoint unavailable');
for(const plan of plans){
 if(plan.address.toLowerCase()!==safe||!validateRouterCandidate(plan.route,plan.mandateVersion,plan.candidate))throw Error('Stored order identity is inconsistent');
 const decoded=decodeFunctionData({abi:parseAbi(['function execute(bytes,bytes[],uint256) payable']),data:plan.candidate.data});
 if(decoded.args[2]>=BigInt(final.timestamp))throw Error('Order remains executable; reservation stays held');
}
// The public log endpoint rejects range reads. Instead prove a complete sequence
// of owner nonces using archive counts and independently canonical RPC receipts.
// Explorer absence alone is never evidence: every nonce must be accounted for.
const start=plans.reduce((min,plan)=>BigInt(plan.route.block)<min?BigInt(plan.route.block):min,BigInt(final.number))-1n;
if(start<0n)throw Error('Invalid history start');
const envelopes=plans.map(plan=>rolesOperation(plan.route,plan.mandateVersion,plan.livePolicy));
if(envelopes.some(envelope=>envelope.from.toLowerCase()!==owner))throw Error('Unexpected signing owner');
const firstNonce=BigInt(await rpc('eth_getTransactionCount',[owner,toHex(start)]));
const endNonce=BigInt(await rpc('eth_getTransactionCount',[owner,final.number]));
if(endNonce<firstNonce||endNonce-firstNonce>200n)throw Error('Nonce history exceeded recovery bounds');
const discovered=new Map();let ranges=0;
async function locate(from,to,nonceFrom,nonceTo){
 if(nonceFrom===nonceTo)return;
 if(nonceTo<nonceFrom||++ranges>4000)throw Error('Invalid or excessive nonce history');
 if(to-from===1n){
  const block=await rpc('eth_getBlockByNumber',[toHex(to),true]);
  if(!Array.isArray(block?.transactions)||BigInt(block.number)!==to)throw Error('Block history unavailable');
  for(const tx of block.transactions)if(tx.from.toLowerCase()===owner){
   const nonce=BigInt(tx.nonce);if(nonce<nonceFrom||nonce>=nonceTo||discovered.has(nonce.toString()))throw Error('Block nonce mismatch');
   discovered.set(nonce.toString(),tx.hash);
  }
  return;
 }
 const middle=(from+to)/2n;const nonceMiddle=BigInt(await rpc('eth_getTransactionCount',[owner,toHex(middle)]));
 if(nonceMiddle<nonceFrom||nonceMiddle>nonceTo)throw Error('Nonmonotonic archive history');
 await locate(from,middle,nonceFrom,nonceMiddle);
 await locate(middle,to,nonceMiddle,nonceTo);
}
await locate(start,BigInt(final.number),firstNonce,endNonce);
let checked=0;
for(let nonce=firstNonce;nonce<endNonce;nonce++){
 const hash=discovered.get(nonce.toString());if(!/^0x[0-9a-f]{64}$/i.test(hash??''))throw Error('Incomplete owner nonce history');
 const tx=await rpc('eth_getTransactionByHash',[hash]);const receipt=await rpc('eth_getTransactionReceipt',[hash]);
 if(!tx||!receipt||tx.from.toLowerCase()!==owner||BigInt(tx.nonce)!==nonce||tx.hash!==hash||receipt.transactionHash!==hash||receipt.blockHash!==tx.blockHash||receipt.blockNumber!==tx.blockNumber||BigInt(tx.blockNumber)<=start||BigInt(tx.blockNumber)>BigInt(final.number))throw Error('Transaction provenance mismatch');
 const header=await rpc('eth_getBlockByNumber',[tx.blockNumber,false]);if(header.hash!==tx.blockHash)throw Error('Noncanonical history');
 if(!['0x0','0x1'].includes(receipt.status))throw Error('Unknown receipt state');
 if(receipt.status==='0x1'&&envelopes.some(envelope=>tx.to?.toLowerCase()===envelope.to.toLowerCase()&&tx.input.toLowerCase()===envelope.data.toLowerCase()))throw Error('Legacy order executed; recover its receipt instead');
 checked++;
}
if((await rpc('eth_getBlockByNumber',[final.number,false])).hash!==final.hash)throw Error('Canonical checkpoint changed');
const evidence={finalizedBlock:final.number,finalizedHash:final.hash,expiredReservations:pending.length,firstNonce:firstNonce.toString(),endNonce:endNonce.toString(),canonicalOwnerTransactionsChecked:checked,allOwnerNoncesAccountedFor:true,noSuccessfulLegacyEnvelope:true,released:false};
fs.writeFileSync('outputs/reservation-recovery-proof.json',JSON.stringify(evidence,null,2));
if(process.argv.includes('--release')){
 const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
 for(const row of pending){const condition=`owner_ref=${quote(row.owner_ref)} AND id=${quote(row.intent_digest)} AND state='reserved' AND transaction_hash IS NULL`;
  query(`UPDATE execution_attempts SET state='released',updated_at=${quote(new Date().toISOString())} WHERE ${condition}; UPDATE autonomy_spends SET state='released' WHERE owner_ref=${quote(row.owner_ref)} AND intent_id=${quote(row.intent_digest)} AND EXISTS(SELECT 1 FROM execution_attempts WHERE ${condition.replace("state='reserved'","state='released'")});`);
 }
 const updated=query(`SELECT state,amount_cents,transaction_hash FROM execution_attempts WHERE address='${safe}'`)[0].results;
 if(updated.filter(row=>row.state==='released').length!==2||updated.filter(row=>row.state==='confirmed').length!==1)throw Error('Recovery needs database verification');
 evidence.released=true;fs.writeFileSync('outputs/reservation-recovery-proof.json',JSON.stringify(evidence,null,2));
}
console.log(JSON.stringify(evidence));
