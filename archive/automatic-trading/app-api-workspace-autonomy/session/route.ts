import {formatUnits,type Hex} from 'viem';
import {inspectTradeRoute} from '@/lib/chain-route';
import {addReviewedSales} from '@/lib/session-sale-draft';
import type {RolesPolicy} from '@/lib/roles-permission';
import {env} from 'cloudflare:workers';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getSessionGrant,saveSessionGrantDraft} from '@/db/autonomous-grants';
import {saveSessionSigner,removeSessionSigner} from '@/db/session-signers';
import {draftAutonomousGrant} from '@/lib/autonomous-grant';
import {assembleActivePolicyFor} from '@/app/api/workspace/orders/live/_shared';
import {AUTONOMOUS_RELEASE_ENABLED} from '@/lib/autonomous-live';
import {executionAccountingSources} from '@/lib/execution-sources';
import {CHAIN} from '@/lib/robinhood-chain';
import {lastRetiredSession} from '@/db/session-lifecycle';import {draftSessionRenewal} from '@/lib/session-renewal';import {inspectSessionRetirement} from '@/lib/session-retirement';import {locateSafe} from '@/app/api/workspace/orders/live/_shared';import {registry} from '@/lib/robinhood-chain';
const headers={'Cache-Control':'no-store'};
export async function GET(){const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});try{const grant=await getSessionGrant(env.DB,user.userId);return Response.json({executionEnabled:AUTONOMOUS_RELEASE_ENABLED,signerStorageConfigured:!!env.STEWARD_SIGNER_ENCRYPTION_KEY,grant:grant?{id:grant.id,state:grant.state,session:grant.session_address,mandateVersion:grant.mandate_version,policy:JSON.parse(grant.policy_json),transaction:JSON.parse(grant.transaction_json),createdAt:grant.created_at}:null,notice:grant?.state==='verified'?'Saved session grant verified. Current execution checks still apply; automatic trading is off.':grant?.state==='paused'?'Server session purchases paused. Onchain revocation must be verified separately.':'Unsigned draft only. Automatic trading is off.'},{headers});}catch{return Response.json({error:'Session enrollment unavailable.'},{status:503,headers});}}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 if(!env.DB||!env.STEWARD_SIGNER_ENCRYPTION_KEY)return Response.json({error:'Encrypted session storage is not configured. No key or grant was created.'},{status:503,headers});
 let includeSales=false;const text=await request.text();if(text.length>200)return Response.json({error:'Request too large.'},{status:413,headers});try{const body=JSON.parse(text);if(body.includeSales!==undefined&&typeof body.includeSales!=='boolean')throw Error();includeSales=body.includeSales===true;if(body.action!=='draft')return Response.json({error:'Only a reviewable draft may be created.'},{status:400,headers});}catch{return Response.json({error:'Invalid request.'},{status:400,headers});}
 let created:string|null=null;
 try{
  if(await getSessionGrant(env.DB,user.userId))return Response.json({error:'A session draft already exists. Review it instead of creating another.'},{status:409,headers});
  const retired=await lastRetiredSession(env.DB,user.userId),old=retired?JSON.parse(retired.grant_json):null;
  const located=old?await locateSafe(env.DB,user.userId):null;
  let renewalOutputs:{symbol:string;token:string}[]=[];
  if(old){const r=await fetch('https://api.robinhood.com/rhj/assets',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Official registry unavailable.');renewalOutputs=registry(await r.json()).filter(r=>r.status==='ASSET_STATUS_ACTIVE'&&!r.pendingMultiplier).map(r=>({symbol:r.symbol,token:r.contract}));}
  if(old&&located&&JSON.parse(old.policy_json).account.toLowerCase()!==located.safe.toLowerCase())throw Error('The Safe changed; renew only the same reviewed mandate.');
  const live=old&&located?{...located,policy:JSON.parse(old.policy_json),plan:{outputs:renewalOutputs}}:await assembleActivePolicyFor(env.DB,user.userId);
  const response=await live.transport(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBlockByNumber',params:['latest',false]}),signal:AbortSignal.timeout(10000)});const head=await response.json() as {id:number;result:{number:string;hash:string;timestamp:string};error?:unknown};if(!response.ok||head.id!==1||head.error||!head.result)throw Error('Fresh block required.');
  const sources=await executionAccountingSources({...head.result,observedAt:new Date().toISOString()},live.transport,fetch),bound=await sources.priceBound('USDG');if(!bound)throw Error('Fresh USDG/USD price required for bounded draft.');
  const retirement=old?await inspectSessionRetirement(live.owner,live.policy,live.transport):null;
  const key=generatePrivateKey(),session=privateKeyToAccount(key).address;
  const snapshot={owner:live.owner,version:live.mandate.version,policyJson:JSON.stringify(live.mandate)};
  const ref=await saveSessionSigner(env.DB,user.userId,session,key);created=session;
  let draft=old&&retirement?draftSessionRenewal(snapshot,ref,live.policy,JSON.parse(old.lease_json),retirement,live.plan.outputs,new Date(),BigInt(bound.upperMicroUsd)):draftAutonomousGrant(snapshot,ref,live.policy,live.plan.outputs,new Date(),BigInt(bound.upperMicroUsd));
  if(includeSales){
   const sales:NonNullable<RolesPolicy['sales']>=[];
   for(const output of draft.policy.outputs){
    const registered=live.plan.outputs.find(o=>o.token.toLowerCase()===output.token.toLowerCase());if(!registered)throw Error('Sale token identity unavailable.');
    const price=await sources.priceBound(registered.symbol),decimals=await sources.tokenDecimals(output.token);if(!price||decimals!==18)throw Error('Verified stock price and decimals required.');
    const raw=BigInt(live.mandate.maxOrderCents)*10000n*10n**18n/BigInt(price.upperMicroUsd);if(raw<=0n)throw Error('Sale lot too small.');
    const route=await inspectTradeRoute(draft.policy.account,registered.symbol,formatUnits(raw,18),'sell',50,live.transport);
    if(!route.best||!route.minimumOutputRaw||Date.parse(route.expiresAt)<=Date.now()||route.token.toLowerCase()!==output.token.toLowerCase())throw Error('Bounded sale quote unavailable.');
    sales.push({token:output.token as Hex,fee:route.best.fee,tickSpacing:route.best.tickSpacing,inputRaw:raw.toString(),minimumOutputRaw:route.minimumOutputRaw});
   }
   if(!await sources.verifyCanonical())throw Error('Draft evidence block changed.');
   draft=addReviewedSales(draft,sales,snapshot,ref);
  }
  const id=await saveSessionGrantDraft(env.DB,user.userId,draft);
  if(!id){await removeSessionSigner(env.DB,user.userId,session);created=null;return Response.json({error:'Another enrollment request won. Load the existing draft.'},{status:409,headers});}
  created=null;
  return Response.json({id,session,policy:draft.policy,transaction:{from:draft.from,to:draft.to,value:draft.value,data:draft.data},executionEnabled:false,activationEnabled:false,notice:draft.notice},{headers});
 }catch{if(created)await removeSessionSigner(env.DB,user.userId,created);return Response.json({error:'Session draft unavailable. No transaction was submitted.'},{status:503,headers});}
}
