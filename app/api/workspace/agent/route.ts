import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {D1DecisionLedger} from '@/db/ledger';
import {getAgent,saveAgent,agentLog} from '@/db/ai-agent';
import {getShadowPlan,controlShadowPlan} from '@/db/autonomous-shadow';
import {getSessionGrant} from '@/db/autonomous-grants';
import {getActivation} from '@/db/autonomous-controls';
import {aiConfigured} from '@/lib/strategy-ai-server';
import {automaticStages} from '@/lib/automatic-stages';
import {validateAgentSettings,type AgentSettings} from '@/lib/ai-agent';
import {AGENT_RULE_ID} from '@/lib/ai-agent-worker';
import type {RolesPolicy} from '@/lib/roles-permission';
const headers={'Cache-Control':'no-store'};

export async function GET(){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(!env.DB)return Response.json({available:false},{headers});
 const [row,mandate,grant,log]=await Promise.all([getAgent(env.DB,user.userId),new D1DecisionLedger(env.DB).getMandate(user.userId),getSessionGrant(env.DB,user.userId),agentLog(env.DB,user.userId)]);
 const armed=grant?.state==='verified'&&(await getActivation(env.DB,user.userId,grant.id))?.state==='armed';
 let settings:AgentSettings|null=null;try{settings=row?JSON.parse(row.settings_json):null;}catch{settings=null;}
 // Sales are fixed when the permission is signed; set it up again after changing the agent's stocks.
 let saleCount=0;try{saleCount=grant?(JSON.parse(grant.policy_json) as RolesPolicy).sales?.length??0:0;}catch{saleCount=0;}
 const stages=automaticStages(env);
 return Response.json({available:aiConfigured(env)&&stages.autoBuy,settings,enabled:row?.enabled===1,nextRunAt:row?.next_run_at??null,armed,allowed:mandate?.allowedSymbols??[],lotCents:mandate?Math.min(mandate.maxOrderCents,stages.maxOrderCents):0,dailyCents:mandate?Math.min(mandate.maxDailyBuyCents,stages.maxDailyCents):0,saleCount,log},{headers});
}

export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 if(!env.DB||!aiConfigured(env)||!automaticStages(env).autoBuy)return Response.json({error:'The Steward agent is not available yet.'},{status:503,headers});
 const text=await request.text();if(text.length>2000)return Response.json({error:'Request too large.'},{status:413,headers});
 try{
  const body=JSON.parse(text) as {settings?:AgentSettings;enabled?:boolean};
  const mandate=await new D1DecisionLedger(env.DB).getMandate(user.userId);if(!mandate?.allowedSymbols.length)return Response.json({error:'Save your Limits first.'},{status:409,headers});
  let settings:AgentSettings;try{settings=validateAgentSettings(body.settings as AgentSettings,mandate.allowedSymbols);}catch(e){return Response.json({error:e instanceof Error?e.message:'Invalid agent settings.'},{status:400,headers});}
  const enabled=body.enabled===true;
  await saveAgent(env.DB,user.userId,settings,enabled);
  // Turning the agent off also parks anything it had queued.
  if(!enabled){const plan=await getShadowPlan(env.DB,user.userId,AGENT_RULE_ID);if(plan?.enabled===1)await controlShadowPlan(env.DB,user.userId,plan.revision,false,new Date(),AGENT_RULE_ID);}
  return Response.json({ok:true,settings,enabled},{headers});
 }catch{return Response.json({error:'Agent settings could not be saved.'},{status:503,headers});}
}
