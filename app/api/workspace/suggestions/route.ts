import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {D1DecisionLedger} from '@/db/ledger';
import {listShadowPlans} from '@/db/autonomous-shadow';
import {claimAIRequest} from '@/db/strategy-ai-usage';
import {marketHistory} from '@/lib/market-chart';
import {aiConfigured,askModelJson} from '@/lib/strategy-ai-server';
import {contextFor,reviewSuggestions,suggestionInput,SUGGESTION_PROMPT,type MarketContext} from '@/lib/rule-suggestions';
import type {AutonomousRule} from '@/lib/autonomous-live';
import type {ReplayRule} from '@/lib/replay';
const headers={'Cache-Control':'no-store'};
export async function GET(){const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});return Response.json({available:aiConfigured(env)&&!!env.DB},{headers});}
// Proposes rules only. Nothing is saved, started or traded here.
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 if(!env.DB||!aiConfigured(env))return Response.json({error:'Suggestions are not available yet.'},{status:503,headers});
 try{
  const mandate=await new D1DecisionLedger(env.DB).getMandate(user.userId);if(!mandate?.allowedSymbols.length)return Response.json({error:'Save your Limits first.'},{status:409,headers});
  if(!await claimAIRequest(env.DB,user.userId))return Response.json({error:'Suggestion limit reached. Wait 15 seconds; daily limits reset at midnight UTC.'},{status:429,headers});
  const markets:MarketContext[]=[];
  for(const symbol of mandate.allowedSymbols.slice(0,8)){const c=contextFor(symbol,(await marketHistory(env.DB,symbol,30)).map(s=>({observedAt:s.observedAt,bidCents:s.bidCents,askCents:s.askCents})));if(c)markets.push(c);}
  if(!markets.length)return Response.json({error:'Not enough saved prices for your stocks yet. Try again after a few days of checks.'},{status:422,headers});
  const existing=(await listShadowPlans(env.DB,user.userId)).map(p=>JSON.parse(p.rule_json) as AutonomousRule);
  const existingReplay:ReplayRule[]=existing.map(r=>({kind:r.trailBps?'sell_trailing':r.kind as ReplayRule['kind'],symbol:r.symbol,amountCents:r.amountCents,thresholdCents:r.thresholdCents,intervalMinutes:r.intervalMinutes,...(r.trailBps?{trailBps:r.trailBps}:{})}));
  const output=await askModelJson(SUGGESTION_PROMPT,suggestionInput(markets,mandate,existingReplay.map(r=>`${r.kind} ${r.symbol}`)),env);
  const suggestions=reviewSuggestions(output,markets,mandate,existingReplay);
  return Response.json({suggestions,note:'Suggestions are ideas, not advice. Each was checked against your Limits and replayed on saved prices. Adding one creates a paused rule.'},{headers});
 }catch{return Response.json({error:'Steward could not suggest valid rules right now. Nothing was changed.'},{status:503,headers});}
}
