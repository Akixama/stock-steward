import {claimChainRead} from '@/db/chain-observations';
import {automaticStages} from '@/lib/automatic-stages';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {locateSafe} from '@/app/api/workspace/orders/live/_shared';
import {getSessionGrant,recordSessionGrantVerification,pauseSessionGrant} from '@/db/autonomous-grants';
import {verifyAutonomousGrant} from '@/lib/autonomous-grant-proof';
import type {Hex} from 'viem';
const headers={'Cache-Control':'no-store'};
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});const text=await request.text();if(text.length>450)return Response.json({error:'Request too large.'},{status:413,headers});
 if(!automaticStages(env).autoBuy)return Response.json({error:'Automatic session verification is off.'},{status:403,headers});
 try{const body=JSON.parse(text) as {action:string;id:string;creationTx:Hex;grantTx:Hex};if(typeof body.id!=='string'||body.id.length>100||!['verify','pause'].includes(body.action))return Response.json({error:'Invalid request.'},{status:400,headers});const grant=await getSessionGrant(env.DB,user.userId);if(!grant||grant.id!==body.id)return Response.json({error:'Grant unavailable.'},{status:404,headers});if(body.action==='pause')return Response.json({paused:await pauseSessionGrant(env.DB,user.userId,grant.id),executionEnabled:false,notice:'Server execution paused. Onchain permission requires a separate wallet revocation.'},{headers});if(grant.state!=='draft')return Response.json({error:'This draft has already changed. Reload its status.'},{status:409,headers});
 if(!await claimChainRead(env.DB,user.userId))return Response.json({error:"Please wait 15 seconds between chain checks."},{status:429,headers});const located=await locateSafe(env.DB,user.userId),policy=JSON.parse(grant.policy_json);if(policy.account.toLowerCase()!==located.safe.toLowerCase())return Response.json({error:'Wallet changed.'},{status:409,headers});const snapshot={owner:located.owner,version:located.mandate.version,policyJson:JSON.stringify(located.mandate)};
 const proof=await verifyAutonomousGrant(snapshot,policy,JSON.parse(grant.lease_json),JSON.parse(grant.transaction_json),body.creationTx,body.grantTx,located.transport);if(!proof.verified)return Response.json({error:proof.why,executionEnabled:false},{status:422,headers});const saved=await recordSessionGrantVerification(env.DB,user.userId,grant.id,body.creationTx,body.grantTx,proof.observedAt);return Response.json({verified:saved,executionEnabled:false,notice:proof.why},{status:saved?200:409,headers});
 }catch{return Response.json({error:'Grant verification unavailable. No transaction was submitted.',executionEnabled:false},{status:503,headers});}
}
