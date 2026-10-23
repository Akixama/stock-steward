import {loadPractice} from '@/db/practice-sessions';
import {D1DecisionLedger} from '@/db/ledger';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getShadowPlan,saveShadowPlan,controlShadowPlan,shadowHistory} from '@/db/autonomous-shadow';
import {type AutonomousRule} from '@/lib/autonomous-live';
import {automaticStages} from '@/lib/automatic-stages';
import {automaticEvents} from '@/db/automatic-stage-events';
import {getOwnership} from '@/db/wallet-ownership';
import {stagesForWallet} from '@/lib/automatic-stages';
const headers={'Cache-Control':'no-store'};
export async function GET(){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});
 try{const ownership=await getOwnership(env.DB,user.userId),stages=stagesForWallet(automaticStages(env),ownership?.verifiedAt?ownership.address:null),plan=await getShadowPlan(env.DB,user.userId),practice=await loadPractice(env.DB,user.userId);return Response.json({availableStrategy:practice.strategy??null,stages,notice:stages.autoBuy?'Automatic buys require separate signed authority and every release check.':stages.approveByNotification?'Ideas require your exact-order wallet signature.':'Strategy checks only. No spending or wallet signature.',plan:plan?{revision:plan.revision,rule:JSON.parse(plan.rule_json),enabled:plan.enabled===1,nextDueAt:plan.next_due_at,failures:plan.failures}:null,runs:await shadowHistory(env.DB,user.userId),events:await automaticEvents(env.DB,user.userId)},{headers});}
 catch{return Response.json({error:'Shadow runner unavailable.'},{status:503,headers});}
}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});
 const text=await request.text();if(text.length>1500)return Response.json({error:'Request too large.'},{status:413,headers});
 let body:{action?:unknown;revision?:unknown;rule?:unknown;strategyVersion?:unknown};try{body=JSON.parse(text);}catch{return Response.json({error:'Invalid request.'},{status:400,headers});}
 if(!body||!Number.isSafeInteger(body.revision)||Number(body.revision)<0||!['save','use_strategy','pause','resume'].includes(String(body.action)))return Response.json({error:'Use save, pause or resume with the current revision.'},{status:400,headers});
 // No action on this endpoint can activate a real-money signer.
 if(body.action!=='pause'&&(!automaticStages(env).shadow||!env.STEWARD_WORKER_KEY))return Response.json({error:'Background strategy checks are off.'},{status:503,headers});
 try{
 if(body.action==='use_strategy'){
  const practice=await loadPractice(env.DB,user.userId),strategy=practice.strategy,mandate=await new D1DecisionLedger(env.DB).getMandate(user.userId);
  if(!strategy||strategy.version!==body.strategyVersion||!mandate)throw Error('Saved strategy changed.');
  const targets=strategy.kind==='portfolio'?strategy.targets!.map(t=>t.symbol):[strategy.symbol];
  if(targets.some(s=>!mandate.allowedSymbols.includes(s))||strategy.amountCents>mandate.maxOrderCents)throw Error('Strategy exceeds the mandate.');
  const rule:AutonomousRule={version:strategy.version,symbol:strategy.symbol,amountCents:strategy.amountCents,thresholdCents:strategy.thresholdCents,kind:strategy.kind,intervalMinutes:15,strategy:{...strategy,mode:'automatic'}};
  if(!await saveShadowPlan(env.DB,user.userId,Number(body.revision),rule,false))return Response.json({error:'Controls changed. Reload first.'},{status:409,headers});
  return Response.json({saved:true,mode:'shadow',executionEnabled:false},{headers});
 }
 const changed=body.action==='save'?await saveShadowPlan(env.DB,user.userId,Number(body.revision),body.rule as AutonomousRule,false):await controlShadowPlan(env.DB,user.userId,Number(body.revision),body.action==='resume');if(!changed)return Response.json({error:'Controls changed. Reload before trying again.'},{status:409,headers});return Response.json({saved:true,mode:'shadow',executionEnabled:false},{headers});}
 catch{return Response.json({error:'Invalid rule or unavailable storage.'},{status:422,headers});}
}
