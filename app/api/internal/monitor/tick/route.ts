import {chainTransport,chainHealth} from '@/lib/chain-transport';
import {env} from 'cloudflare:workers';
import {workerTick,fastRulesTick} from '@/lib/autonomy-worker';
import {dispatchOperatorAlerts} from '@/lib/operator-alerts';
import {checkBackgroundAlerts} from '@/lib/web-push';
import {sampleScheduledMarkets,sampleFastRuleMarkets} from '@/lib/market-chart';
import {automaticStages} from '@/lib/automatic-stages';
import {tickAgents,chainHoldings} from '@/lib/ai-agent-worker';
import {aiConfigured,askAgentModel} from '@/lib/strategy-ai-server';
import {readLiveNews,configuredLiveNews} from '@/lib/live-news';
import {sendAutomaticPush} from '@/lib/automatic-stage-push';
import {sendPermissionExpiryReminders} from '@/lib/permission-expiry-reminder';

const headers={'Cache-Control':'no-store'};
// Steward agent decisions run first, so an approved trade is executed by the
// rule check in this same tick. An AI or data failure only ever means "hold".
async function runAgents(stages:ReturnType<typeof automaticStages>){
  if(!stages.autoBuy||!aiConfigured(env)||!env.DB)return {off:true};
  try{const transport=chainTransport(env.ALCHEMY_API_KEY);const config=await configuredLiveNews();
    // Headlines only when a news account is configured; otherwise prices alone.
    const news=async(symbols:string[])=>{const r=await readLiveNews(symbols,config);if(r.state!=='ready')return {};const out:Record<string,string[]>={};for(const item of r.news.items.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)))for(const s of item.symbols)(out[s]??=[]).push(item.headline);return out;};
    return await tickAgents(env.DB,{ask:(system,user)=>askAgentModel(system,user,env),news,holdings:account=>chainHoldings(account,transport),maxOrderCents:stages.maxOrderCents});}
  catch{return {unavailable:true};}
}

export async function POST(request:Request){
  const expected=env.STEWARD_WORKER_KEY;
  if(!expected||!env.DB)return Response.json({error:'Runner unavailable.'},{status:503,headers});
  const received=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
  if(!/^[a-f0-9]{64}$/.test(received)||!/^[a-f0-9]{64}$/.test(expected))return Response.json({error:'Unauthorized.'},{status:401,headers});
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(received)),crypto.subtle.digest('SHA-256',encoder.encode(expected))]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let mismatch=0;
  for(let i=0;i<aa.length;i++)mismatch|=aa[i]^bb[i];
  if(mismatch)return Response.json({error:'Unauthorized.'},{status:401,headers});
  if(new URL(request.url).searchParams.get('health')==='1'){
    const key=new URL(request.url).searchParams.get('provider')==='public'?undefined:env.ALCHEMY_API_KEY;
    return Response.json({health:await chainHealth(chainTransport(key)),provider:key?'alchemy':'public',spendingEnabled:false},{headers});
  }
  if(new URL(request.url).searchParams.get('fast')==='1'){
    try{
      const stages=automaticStages(env);let markets;
      try{markets=await sampleFastRuleMarkets(env.DB);}catch{markets={unavailable:true};}
      const agents=await runAgents(stages);
      const summary=await fastRulesTick(env.DB,chainTransport(env.ALCHEMY_API_KEY),stages);
      let automaticNotifications;
      try{automaticNotifications=await sendAutomaticPush(env.DB,{publicKey:env.STEWARD_VAPID_PUBLIC_KEY??'',privateKey:env.STEWARD_VAPID_PRIVATE_KEY??''});}catch{automaticNotifications={unavailable:true};}
      return Response.json({summary,agents,markets,automaticNotifications,spendingEnabled:stages.autoBuy},{headers});
    }catch{return Response.json({error:'Fast rule check did not complete. No order was retried.'},{status:503,headers});}
  }
  try{
    let markets;
    try{markets=await sampleScheduledMarkets(env.DB);}catch{markets={unavailable:true};}
    const stages=automaticStages(env);
    const agents=await runAgents(stages);
    const summary=await workerTick(env.DB,chainTransport(env.ALCHEMY_API_KEY),stages);
    let automaticNotifications;
    try{automaticNotifications=await sendAutomaticPush(env.DB,{publicKey:env.STEWARD_VAPID_PUBLIC_KEY??'',privateKey:env.STEWARD_VAPID_PRIVATE_KEY??''});}
    catch{automaticNotifications={unavailable:true};}
    let permissionReminders;
    try{permissionReminders=await sendPermissionExpiryReminders(env.DB,{publicKey:env.STEWARD_VAPID_PUBLIC_KEY??'',privateKey:env.STEWARD_VAPID_PRIVATE_KEY??''});}
    catch{permissionReminders={unavailable:true};}
    let alerts;
    try{alerts=await dispatchOperatorAlerts(env.DB,{enabled:env.STEWARD_OPERATOR_ALERTS_ENABLED==='true',url:env.STEWARD_OPERATOR_ALERT_URL??'',secret:env.STEWARD_OPERATOR_ALERT_SECRET??''});}
    catch{alerts={configured:true,unavailable:true};}
    let priceAlerts;
    try{priceAlerts=await checkBackgroundAlerts(env.DB,{publicKey:env.STEWARD_VAPID_PUBLIC_KEY??'',privateKey:env.STEWARD_VAPID_PRIVATE_KEY??''});}
    catch{priceAlerts={unavailable:true};}
    return Response.json({summary,agents,alerts,priceAlerts,markets,automaticNotifications,permissionReminders,spendingEnabled:stages.autoBuy},{headers});
  }catch{
    return Response.json({error:'Monitoring did not complete. Check purchase receipts before taking action; no order was retried.'},{status:503,headers});
  }
}
