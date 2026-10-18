import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {latestWalletAction} from '@/db/wallet-action-attempts';
import {CHAIN_RPC} from '@/app/api/workspace/orders/live/_shared';

const headers={'Cache-Control':'no-store'};
type Row={id:string;owner_ref:string;owner_address:string;safe:string;kind:string;symbol:string;quantity:string;state:string;transaction_json:string;transaction_hash:string|null};
type ChainTx={from?:string;to?:string;input?:string;value?:string};
type ChainReceipt={status?:string;blockNumber?:string};

async function chain(method:string,params:unknown[]){
 const response=await fetch(CHAIN_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000),cache:'no-store'});
 const body=await response.json() as {result?:unknown;error?:unknown};
 if(!response.ok||body.error||body.result===undefined)throw Error('Chain receipt unavailable. Keep this hash and check again.');
 return body.result;
}

export async function GET(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(!env.DB)return Response.json({error:'Workspace storage unavailable.'},{status:503,headers});
 const url=new URL(request.url),safe=url.searchParams.get('safe'),kind=url.searchParams.get('kind');
 if(safe&&!/^0x[0-9a-f]{40}$/i.test(safe))return Response.json({error:'Invalid wallet.'},{status:400,headers});
 if(kind&&kind!=='sell'&&kind!=='transfer')return Response.json({error:'Invalid action.'},{status:400,headers});
 const latest=kind?await env.DB.prepare(`SELECT id,safe,kind,symbol,quantity,state,transaction_hash AS hash,created_at AS createdAt FROM wallet_action_attempts WHERE owner_ref=? AND (? IS NULL OR safe=?) AND kind=? AND transaction_hash IS NOT NULL ORDER BY updated_at DESC LIMIT 1`).bind(user.userId,safe,safe?.toLowerCase()??null,kind).first():await latestWalletAction(env.DB,user.userId,safe??undefined);
 return Response.json({latest},{headers});
}

export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin.'},{status:403,headers});
 if(!env.DB)return Response.json({error:'Workspace storage unavailable.'},{status:503,headers});
 try{
  const body=await request.json() as {id?:unknown;hash?:unknown};
  if(typeof body.id!=='string'||!/^0x[0-9a-f]{64}$/i.test(body.id)||typeof body.hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(body.hash))return Response.json({error:'Invalid saved attempt or transaction hash.'},{status:400,headers});
  const row=await env.DB.prepare('SELECT * FROM wallet_action_attempts WHERE owner_ref=? AND id=?').bind(user.userId,body.id.toLowerCase()).first<Row>();
  if(!row)return Response.json({error:'Saved attempt unavailable.'},{status:404,headers});
  if(row.transaction_hash && row.transaction_hash.toLowerCase()!==body.hash.toLowerCase())return Response.json({error:'A different transaction is already saved for this attempt.'},{status:409,headers});
  const recorded=await env.DB.prepare("UPDATE wallet_action_attempts SET transaction_hash=?,state='submitted',updated_at=? WHERE owner_ref=? AND id=? AND state IN ('prepared','submitted','unknown') AND (transaction_hash IS NULL OR transaction_hash=?)")
   .bind(body.hash.toLowerCase(),new Date().toISOString(),user.userId,row.id,body.hash.toLowerCase()).run();
  if(recorded.meta.changes!==1 && !row.transaction_hash)return Response.json({error:'Receipt could not be saved. Keep the hash; do not send again.'},{status:409,headers});
  let tx:ChainTx|null=null;
  let receipt:ChainReceipt|null=null;
  try{
   tx=await chain('eth_getTransactionByHash',[body.hash]) as ChainTx|null;
   receipt=await chain('eth_getTransactionReceipt',[body.hash]) as ChainReceipt|null;
  }catch{return Response.json({id:row.id,hash:body.hash,state:'submitted',receipt:null,notice:'Hash saved. The chain receipt is unavailable right now; check the same hash later. Do not send again.'},{headers});}
  if(!tx||!receipt)return Response.json({id:row.id,hash:body.hash,state:'submitted',receipt:null,notice:'Waiting for a chain receipt. Do not send again.'},{headers});
  const expected=JSON.parse(row.transaction_json) as {from:string;to:string;data:string;value:string};
  if(tx.from?.toLowerCase()!==expected.from.toLowerCase()||tx.to?.toLowerCase()!==expected.to.toLowerCase()||tx.input?.toLowerCase()!==expected.data.toLowerCase()||BigInt(tx.value??'-1')!==BigInt(expected.value))
   return Response.json({id:row.id,hash:body.hash,state:'unknown',receipt:null,notice:'The chain transaction does not match this saved action. Do not send again.'},{status:409,headers});
  if(receipt.status==='0x0'){
   await env.DB.prepare("UPDATE wallet_action_attempts SET state='reverted',updated_at=? WHERE owner_ref=? AND id=? AND transaction_hash=?").bind(new Date().toISOString(),user.userId,row.id,body.hash.toLowerCase()).run();
   return Response.json({id:row.id,hash:body.hash,state:'reverted',receipt:{status:receipt.status,blockNumber:receipt.blockNumber},notice:'The chain transaction reverted. No sale or transfer was verified.'},{headers});
  }
  await env.DB.prepare("UPDATE wallet_action_attempts SET state='unknown',updated_at=? WHERE owner_ref=? AND id=? AND transaction_hash=? AND state='submitted'").bind(new Date().toISOString(),user.userId,row.id,body.hash.toLowerCase()).run();
  return Response.json({id:row.id,hash:body.hash,state:'unknown',receipt:{status:receipt.status,blockNumber:receipt.blockNumber},notice:'The chain transaction succeeded. Check the wallet balances to verify the sale or transfer; do not send again.'},{headers});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Receipt unavailable. Keep the hash and do not send again.'},{status:502,headers});}
}
