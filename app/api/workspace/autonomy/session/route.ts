import {env} from 'cloudflare:workers';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getSessionGrant,saveSessionGrantDraft} from '@/db/autonomous-grants';
import {saveSessionSigner,removeSessionSigner} from '@/db/session-signers';
import {draftAutonomousGrant} from '@/lib/autonomous-grant';
import {assembleActivePolicyFor} from '@/app/api/workspace/orders/live/_shared';
import {automaticStages} from '@/lib/automatic-stages';
import {ownerAutomaticStages} from '@/lib/wallet-stage-access';
import {executionAccountingSources} from '@/lib/execution-sources';
import {CHAIN} from '@/lib/robinhood-chain';
import {isSessionWindowDays} from '@/lib/permission-window';
import {saveSetupChoices} from '@/db/autonomous-controls';
import {listShadowPlans} from '@/db/autonomous-shadow';
import {addReviewedSales} from '@/lib/session-sale-draft';
import {saleLot,isSellKind} from '@/lib/session-sale-lot';
import type {AutonomousRule} from '@/lib/autonomous-live';
import {lastRetiredSession} from '@/db/session-lifecycle';import {draftSessionRenewal} from '@/lib/session-renewal';import {inspectSessionRetirement} from '@/lib/session-retirement';import {locateSafe} from '@/app/api/workspace/orders/live/_shared';import {registry} from '@/lib/robinhood-chain';
const headers={'Cache-Control':'no-store'};
export async function GET(){const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});try{const grant=await getSessionGrant(env.DB,user.userId),stages=await ownerAutomaticStages(env.DB,user.userId,env);return Response.json({executionEnabled:stages.autoBuy,signerStorageConfigured:!!env.STEWARD_SIGNER_ENCRYPTION_KEY,grant:grant?{id:grant.id,state:grant.state,session:grant.session_address,mandateVersion:grant.mandate_version,policy:JSON.parse(grant.policy_json),transaction:JSON.parse(grant.transaction_json),createdAt:grant.created_at}:null,notice:grant?.state==='verified'?'Saved session grant verified. Current execution checks still apply; automatic trading requires your separate start approval.':grant?.state==='paused'?'Server session purchases paused. Onchain revocation must be verified separately.':'Unsigned draft only. Automatic trading is off.'},{headers});}catch{return Response.json({error:'Session enrollment unavailable.'},{status:503,headers});}}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 if(!env.DB||!await ownerAutomaticStages(env.DB,user.userId,env).then(s=>s.autoBuy).catch(()=>false))return Response.json({error:'Automatic session setup is off for this wallet. No key or grant was created.'},{status:403,headers});
 if(!env.DB||!env.STEWARD_SIGNER_ENCRYPTION_KEY)return Response.json({error:'Encrypted session storage is not configured. No key or grant was created.'},{status:503,headers});
 const text=await request.text();if(text.length>200)return Response.json({error:'Request too large.'},{status:413,headers});let days:number=2,maxFeeCents=50;try{const body=JSON.parse(text);days=body.days??2;maxFeeCents=body.maxFeeCents??50;if(!isSessionWindowDays(days))return Response.json({error:'Choose 2, 7, 14 or 30 days.'},{status:400,headers});if(!Number.isSafeInteger(maxFeeCents)||maxFeeCents<1||maxFeeCents>1000)return Response.json({error:'Fee limit must be $0.01 to $10.'},{status:400,headers});if(body.action!=='draft')return Response.json({error:'Only a reviewable draft may be created.'},{status:400,headers});}catch{return Response.json({error:'Invalid request.'},{status:400,headers});}
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
  // Your saved Limits are the agent's limits, within the platform ceiling.
  const stageCaps=automaticStages(env),caps={orderCents:Math.min(live.mandate.maxOrderCents,stageCaps.maxOrderCents),dailyCents:Math.min(live.mandate.maxDailyBuyCents,stageCaps.maxDailyCents),days,totalCents:stageCaps.hardCeilingCents};
  const draft=old&&retirement?draftSessionRenewal(snapshot,ref,live.policy,JSON.parse(old.lease_json),retirement,live.plan.outputs,new Date(),BigInt(bound.upperMicroUsd),caps):draftAutonomousGrant(snapshot,ref,live.policy,live.plan.outputs,new Date(),BigInt(bound.upperMicroUsd),caps);
  // v2 auto-sell: a saved sell rule adds one fixed sale lot for its stock. The
  // quantity is worth at most the rule amount and the minimum USDG proceeds are
  // encoded onchain. Sales share the permission's trade-count limit.
  let reviewed=draft;
  // One sale lot per stock with a sell rule (the permission allows six).
  const sellRules=(await listShadowPlans(env.DB,user.userId)).map(p=>JSON.parse(p.rule_json) as AutonomousRule).filter(r=>isSellKind(r.kind));
  const lots=[];const seen=new Set<string>();
  for(const rule of sellRules){
   if(seen.has(rule.symbol)||lots.length>=6||!isSellKind(rule.kind))continue;seen.add(rule.symbol);
   const token=live.plan.outputs.find(o=>o.symbol===rule.symbol)?.token,output=token?draft.policy.outputs.find(o=>o.token.toLowerCase()===token.toLowerCase()):undefined;
   if(!output)throw Error('A sell rule stock is not in your limits.');
   const [decimals,price]=await Promise.all([sources.tokenDecimals(output.token),sources.priceBound(rule.symbol)]);
   if(decimals===null||!price)throw Error('Fresh token data required for a sale lot.');
   lots.push(saleLot({output,decimals,amountCents:Math.min(rule.amountCents,caps.orderCents),kind:rule.kind,thresholdCents:rule.thresholdCents,priceUpperMicroUsd:BigInt(price.upperMicroUsd),priceLowerMicroUsd:BigInt(price.lowerMicroUsd)}));
  }
  if(lots.length)reviewed=addReviewedSales(draft as Parameters<typeof addReviewedSales>[0],lots,snapshot,ref);
  const id=await saveSessionGrantDraft(env.DB,user.userId,reviewed);
  if(!id){await removeSessionSigner(env.DB,user.userId,session);created=null;return Response.json({error:'Another enrollment request won. Load the existing draft.'},{status:409,headers});}
  created=null;
  await saveSetupChoices(env.DB,user.userId,id,maxFeeCents,days);
  return Response.json({id,session,policy:reviewed.policy,transaction:{from:reviewed.from,to:reviewed.to,value:reviewed.value,data:reviewed.data},executionEnabled:false,activationEnabled:false,notice:reviewed.notice},{headers});
 }catch{if(created)await removeSessionSigner(env.DB,user.userId,created);return Response.json({error:'Session draft unavailable. No transaction was submitted.'},{status:503,headers});}
}
