import {claimChainRead} from '@/db/chain-observations';
import {ownerAutomaticStages} from '@/lib/wallet-stage-access';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {locateSafe} from '@/app/api/workspace/orders/live/_shared';
import {getSessionGrant,recordSessionGrantVerification,pauseSessionGrant} from '@/db/autonomous-grants';
import {verifyAutonomousGrant} from '@/lib/autonomous-grant-proof';
import type {Hex} from 'viem';
import {findModuleCreation} from '@/lib/find-module-creation';
import {getSetupChoices,saveFeeConsent,saveActivation} from '@/db/autonomous-controls';
import {installationConsents} from '@/lib/installation-consent';
import {mandateDigest} from '@/lib/policy-lease';
import type {FeeConsent} from '@/lib/autonomous-consent';
import type {ActivationConsent} from '@/lib/autonomous-activation';
const headers={'Cache-Control':'no-store'};
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});const text=await request.text();if(text.length>450)return Response.json({error:'Request too large.'},{status:413,headers});
 if(!await ownerAutomaticStages(env.DB,user.userId,env).then(s=>s.autoBuy).catch(()=>false))return Response.json({error:'Automatic session verification is off for this wallet.'},{status:403,headers});
 try{const body=JSON.parse(text) as {action:string;id:string;creationTx?:Hex;grantTx:Hex};if(typeof body.id!=='string'||body.id.length>100||!['verify','pause'].includes(body.action))return Response.json({error:'Invalid request.'},{status:400,headers});const grant=await getSessionGrant(env.DB,user.userId);if(!grant||grant.id!==body.id)return Response.json({error:'Grant unavailable.'},{status:404,headers});if(body.action==='pause')return Response.json({paused:await pauseSessionGrant(env.DB,user.userId,grant.id),executionEnabled:false,notice:'Server execution paused. Onchain permission requires a separate wallet revocation.'},{headers});if(grant.state!=='draft')return Response.json({error:'This draft has already changed. Reload its status.'},{status:409,headers});
 if(!await claimChainRead(env.DB,user.userId))return Response.json({error:"Please wait 15 seconds between chain checks."},{status:429,headers});const located=await locateSafe(env.DB,user.userId),policy=JSON.parse(grant.policy_json);if(policy.account.toLowerCase()!==located.safe.toLowerCase())return Response.json({error:'Wallet changed.'},{status:409,headers});const snapshot={owner:located.owner,version:located.mandate.version,policyJson:JSON.stringify(located.mandate)};
 const creationTx=body.creationTx??await findModuleCreation(policy.module,located.transport);if(!creationTx)return Response.json({error:'Could not find your Roles module setup on chain yet. Try again in a minute.',executionEnabled:false},{status:422,headers});
 const proof=await verifyAutonomousGrant(snapshot,policy,JSON.parse(grant.lease_json),JSON.parse(grant.transaction_json),creationTx,body.grantTx,located.transport);if(!proof.verified)return Response.json({error:proof.why,executionEnabled:false},{status:422,headers});const saved=await recordSessionGrantVerification(env.DB,user.userId,grant.id,creationTx,body.grantTx,proof.observedAt);
 // One-signature setup: the verified installation arms automatic trading with
 // the fee limit chosen before signing. Pause and revoke stay one tap away.
 let armed=false;const choices=saved?await getSetupChoices(env.DB,user.userId,grant.id):null;
 if(saved&&choices){const fresh=await getSessionGrant(env.DB,user.userId);if(fresh&&fresh.state==='verified'){const c=installationConsents(fresh,new URL(request.url).origin,choices.max_fee_cents,mandateDigest(snapshot));if(await saveFeeConsent(env.DB,user.userId,c.fee as unknown as FeeConsent,c.signature))armed=!!(await saveActivation(env.DB,user.userId,c.start as unknown as ActivationConsent,c.signature));}}
 return Response.json({verified:saved,armed,executionEnabled:armed,notice:armed?'Permission verified on chain. Steward is now allowed to trade for you within your Limits.':proof.why},{status:saved?200:409,headers});
 }catch{return Response.json({error:'Grant verification unavailable. No transaction was submitted.',executionEnabled:false},{status:503,headers});}
}
