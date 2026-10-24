import {loadPractice} from '@/db/practice-sessions';
import {D1DecisionLedger} from '@/db/ledger';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {saveShadowPlan,controlShadowPlan,shadowHistory,listShadowPlans,deleteShadowPlan,isRuleId,MAX_RULES} from '@/db/autonomous-shadow';
import {type AutonomousRule} from '@/lib/autonomous-live';
import {automaticStages} from '@/lib/automatic-stages';
import {automaticEvents} from '@/db/automatic-stage-events';
import {getOwnership} from '@/db/wallet-ownership';
import {stagesForWallet} from '@/lib/automatic-stages';
import {tickAutonomousShadow} from '@/lib/autonomous-shadow-worker';
import {chainTransport} from '@/lib/chain-transport';
const headers={'Cache-Control':'no-store'};
export async function GET(){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});
 try{const ownership=await getOwnership(env.DB,user.userId),stages=stagesForWallet(automaticStages(env),ownership?.verifiedAt?ownership.address:null),plans=await listShadowPlans(env.DB,user.userId),practice=await loadPractice(env.DB,user.userId);const shape=(p:typeof plans[number])=>({ruleId:p.rule_id,revision:p.revision,rule:JSON.parse(p.rule_json),enabled:p.enabled===1,nextDueAt:p.next_due_at,failures:p.failures});const main=plans.find(p=>p.rule_id==='main')??plans[0];return Response.json({availableStrategy:practice.strategy??null,stages,notice:stages.autoBuy?'Automatic buys require separate signed authority and every release check.':stages.approveByNotification?'Ideas require your exact-order wallet signature.':'Strategy checks only. No spending or wallet signature.',plan:main?shape(main):null,plans:plans.map(shape),maxRules:MAX_RULES,runs:await shadowHistory(env.DB,user.userId),events:await automaticEvents(env.DB,user.userId)},{headers});}
 catch{return Response.json({error:'Shadow runner unavailable.'},{status:503,headers});}
}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});
 const text=await request.text();if(text.length>1500)return Response.json({error:'Request too large.'},{status:413,headers});
 let body:{action?:unknown;revision?:unknown;rule?:unknown;strategyVersion?:unknown;ruleId?:unknown};try{body=JSON.parse(text);}catch{return Response.json({error:'Invalid request.'},{status:400,headers});}
 if(!body||!Number.isSafeInteger(body.revision)||Number(body.revision)<0||!['save','use_strategy','pause','resume','check_now','delete'].includes(String(body.action)))return Response.json({error:'Use save, pause or resume with the current revision.'},{status:400,headers});
 const ruleId=body.ruleId===undefined?'main':body.ruleId;if(!isRuleId(ruleId))return Response.json({error:'Invalid rule.'},{status:400,headers});
 // No action on this endpoint can activate a real-money signer.
 if(body.action!=='pause'&&(!automaticStages(env).shadow||!env.STEWARD_WORKER_KEY))return Response.json({error:'Background strategy checks are off.'},{status:503,headers});
 try{
 if(body.action==='check_now'){
  const [plans,ownership]=await Promise.all([listShadowPlans(env.DB,user.userId),getOwnership(env.DB,user.userId)]);
  if(!plans.some(p=>p.enabled===1)||!ownership?.verifiedAt)return Response.json({error:'Start a rule and verify your wallet first.'},{status:409,headers});
  const stages=stagesForWallet(automaticStages(env),ownership.address);
  // A manual check is always no-spend, even if an autonomous release is later enabled.
  const summary=await tickAutonomousShadow(env.DB,chainTransport(env.ALCHEMY_API_KEY),new Date(),{...stages,autoBuy:false},user.userId);
  return Response.json({summary,executionEnabled:false},{headers});
 }
 if(body.action==='use_strategy'){
  const practice=await loadPractice(env.DB,user.userId),strategy=practice.strategy,mandate=await new D1DecisionLedger(env.DB).getMandate(user.userId);
  if(!strategy||strategy.version!==body.strategyVersion||!mandate)throw Error('Saved strategy changed.');
  const targets=strategy.kind==='portfolio'?strategy.targets!.map(t=>t.symbol):[strategy.symbol];
  if(targets.some(s=>!mandate.allowedSymbols.includes(s))||strategy.amountCents>mandate.maxOrderCents)throw Error('Strategy exceeds the mandate.');
  const rule:AutonomousRule={version:strategy.version,symbol:strategy.symbol,amountCents:strategy.amountCents,thresholdCents:strategy.thresholdCents,kind:strategy.kind,intervalMinutes:15,strategy:{...strategy,mode:'automatic'}};
  if(!await saveShadowPlan(env.DB,user.userId,Number(body.revision),rule,false,new Date(),ruleId))return Response.json({error:'Controls changed. Reload first.'},{status:409,headers});
  return Response.json({saved:true,mode:'shadow',executionEnabled:false},{headers});
 }
 if(body.action==='delete'){if(!await deleteShadowPlan(env.DB,user.userId,ruleId,Number(body.revision)))return Response.json({error:'Rule changed. Reload first.'},{status:409,headers});return Response.json({deleted:true,executionEnabled:false},{headers});}
 const changed=body.action==='save'?await saveShadowPlan(env.DB,user.userId,Number(body.revision),body.rule as AutonomousRule,false,new Date(),ruleId):await controlShadowPlan(env.DB,user.userId,Number(body.revision),body.action==='resume',new Date(),ruleId);if(!changed)return Response.json({error:'Controls changed. Reload before trying again.'},{status:409,headers});return Response.json({saved:true,mode:'shadow',executionEnabled:false},{headers});}
 catch(e){return Response.json({error:e instanceof Error&&e.message==='RULE_LIMIT'?`You can have up to ${MAX_RULES} rules.`:'Invalid rule or unavailable storage.'},{status:422,headers});}
}
