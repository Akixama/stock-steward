import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {reconcileWalletAction,type SavedWalletAction} from '@/lib/wallet-action-reconcile';
import {chainTransport} from '@/lib/chain-transport';
import {earlyConfirmationCount} from '@/lib/confirmation-status';
import {walletActionView} from '@/db/wallet-action-attempts';

const headers={'Cache-Control':'no-store'};
type Row=SavedWalletAction&{id:string;owner_ref:string;state:string};

export async function GET(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(!env.DB)return Response.json({error:'Workspace storage unavailable.'},{status:503,headers});
 const url=new URL(request.url),safe=url.searchParams.get('safe'),kind=url.searchParams.get('kind');
 if(safe&&!/^0x[0-9a-f]{40}$/i.test(safe))return Response.json({error:'Invalid wallet.'},{status:400,headers});
 if(kind&&kind!=='sell'&&kind!=='transfer')return Response.json({error:'Invalid action.'},{status:400,headers});
 return Response.json(await walletActionView(env.DB,user.userId,safe??undefined,kind as 'sell'|'transfer'|undefined),{headers});
}

export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid request origin.'},{status:403,headers});
 if(!env.DB)return Response.json({error:'Workspace storage unavailable.'},{status:503,headers});
 try{
  const body=await request.json() as {id?:unknown;hash?:unknown};
  if(typeof body.id!=='string'||!/^0x[0-9a-f]{64}$/i.test(body.id)||typeof body.hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(body.hash))return Response.json({error:'Invalid saved attempt or transaction hash.'},{status:400,headers});
  const id=body.id.toLowerCase(),hash=body.hash.toLowerCase();
  const row=await env.DB.prepare('SELECT * FROM wallet_action_attempts WHERE owner_ref=? AND id=?').bind(user.userId,id).first<Row>();
  if(!row)return Response.json({error:'Saved attempt unavailable.'},{status:404,headers});
  if(row.transaction_hash&&row.transaction_hash.toLowerCase()!==hash)return Response.json({error:'A different transaction is already saved for this attempt.'},{status:409,headers});
  if(row.state==='confirmed'||row.state==='reverted')return Response.json({id,hash,state:row.state,notice:row.state==='confirmed'?'This saved action is verified.':'This saved transaction reverted.'},{headers});
  const recorded=await env.DB.prepare("UPDATE wallet_action_attempts SET transaction_hash=?,state='submitted',updated_at=? WHERE owner_ref=? AND id=? AND state IN ('prepared','submitted','unknown') AND (transaction_hash IS NULL OR transaction_hash=?)")
   .bind(hash,new Date().toISOString(),user.userId,id,hash).run();
  if(recorded.meta.changes!==1)return Response.json({error:'Receipt could not be saved. Keep the hash; do not send again.'},{status:409,headers});
  // Receipt reconciliation is read-only. Prefer the configured private RPC and
  // fall back to the public endpoint for transient reads; never broadcast here.
  const proof=await reconcileWalletAction({...row,transaction_hash:hash},chainTransport(env.ALCHEMY_API_KEY),earlyConfirmationCount((env as unknown as Record<string,unknown>).EARLY_CONFIRMATION_BLOCKS));
  await env.DB.prepare("UPDATE wallet_action_attempts SET state=?,updated_at=? WHERE owner_ref=? AND id=? AND transaction_hash=? AND state IN ('prepared','submitted','unknown')")
   .bind(proof.state,new Date().toISOString(),user.userId,id,hash).run();
  const notice=proof.reason==='RPC unavailable'||proof.reason==='RPC transport unavailable'
    ?'Chain status cannot be checked right now. The transaction is saved; do not send it again.'
    :proof.reason;
  return Response.json({id,hash,state:proof.state,confirmation:proof.confirmation??null,receipt:proof.blockNumber?{blockNumber:proof.blockNumber,inputRaw:proof.inputRaw,outputRaw:proof.outputRaw}:null,notice:proof.state==='confirmed'?'Finalized: exact token movement verified in a finalized block.':proof.state==='reverted'?'The saved transaction reverted in a finalized block. Gas may have been spent.':notice},{headers});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Receipt unavailable. Keep the hash and do not send again.'},{status:502,headers});}
}
