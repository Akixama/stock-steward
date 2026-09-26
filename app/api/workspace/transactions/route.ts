import {env} from 'cloudflare:workers';import {getChatGPTUser} from '@/app/chatgpt-auth';
import {listWatches,saveWatch} from '@/db/transaction-watches';import {reconcileTransaction} from '@/lib/chain-reconciliation';import {claimChainRead} from '@/db/chain-observations';
const headers={'Cache-Control':'no-store'};
export async function GET(){const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});
  try{return Response.json({watches:await listWatches(env.DB,user.userId)},{headers});}catch{return Response.json({error:'Transaction watches unavailable.'},{status:503,headers});}}
export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
  if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});
  const text=await request.text();if(text.length>300)return Response.json({error:'Request too large.'},{status:413,headers});
  let body:{address?:unknown;hash?:unknown;removeId?:unknown};try{body=JSON.parse(text);}catch{return Response.json({error:'Invalid request.'},{status:400,headers});}
  if(!body)return Response.json({error:'Invalid request.'},{status:400,headers});
  if(typeof body.removeId==='string'&&/^[a-f0-9-]{36}$/.test(body.removeId)){
    await env.DB.prepare('DELETE FROM chain_transaction_watches WHERE owner_ref=? AND id=?').bind(user.userId,body.removeId).run();return Response.json({removed:true},{headers});}
  if(typeof body.address!=='string'||!/^0x[0-9a-f]{40}$/i.test(body.address)||typeof body.hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(body.hash))return Response.json({error:'Enter a wallet address and transaction hash.'},{status:400,headers});
  try{
    if(!await claimChainRead(env.DB,user.userId))return Response.json({error:'Wait 15 seconds between reads.'},{status:429,headers});
    const previous=(await listWatches(env.DB,user.userId)).find(w=>w.address===String(body.address).toLowerCase()&&w.hash===String(body.hash).toLowerCase())??null;
    const watch=await reconcileTransaction(body.address,body.hash,previous);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([user.userId,watch.address,watch.hash])));
    const id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
    watch.id=previous?.id??`${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
    if(!await saveWatch(env.DB,user.userId,watch))return Response.json({error:'Five watches are already saved, or a newer check was saved. Refresh before trying again.'},{status:409,headers});
    return Response.json({watch},{headers});
  }catch{return Response.json({error:'Transaction watch could not be saved. No transaction was resubmitted.'},{status:503,headers});}
}
