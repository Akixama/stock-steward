import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {D1DecisionLedger} from '@/db/ledger';
import {marketHistory} from '@/lib/market-chart';
import {replayRule,type ReplayRule} from '@/lib/replay';
import {readBoundedText} from '@/lib/strategy-ai-server';
import {z} from 'zod';
const headers={'Cache-Control':'no-store'};
const input=z.object({days:z.union([z.literal(7),z.literal(30)]),rule:z.object({kind:z.enum(['threshold','scheduled','sell_below','sell_threshold']),symbol:z.string().regex(/^[A-Z][A-Z0-9.]{0,7}$/),amountCents:z.number().int().min(1).max(100000),thresholdCents:z.number().int().min(1).max(100000000),intervalMinutes:z.number().int().min(15).max(10080)}).strict()}).strict();
// Read-only: replays a rule over prices Stock Steward already saved.
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 if(!env.DB)return Response.json({error:'Unavailable.'},{status:503,headers});
 let body;try{body=input.parse(JSON.parse(await readBoundedText(request,1000)));}catch{return Response.json({error:'Check the rule details.'},{status:400,headers});}
 try{
  const mandate=await new D1DecisionLedger(env.DB).getMandate(user.userId);if(!mandate)return Response.json({error:'Save your Limits first.'},{status:409,headers});
  const samples=(await marketHistory(env.DB,body.rule.symbol,body.days)).map(s=>({observedAt:s.observedAt,bidCents:s.bidCents,askCents:s.askCents}));
  return Response.json({result:replayRule(body.rule as ReplayRule,mandate,samples),days:body.days},{headers});
 }catch(e){const m=e instanceof Error&&e.message.startsWith('Not enough')?e.message:'Replay is unavailable right now.';return Response.json({error:m},{status:m.startsWith('Not enough')?422:503,headers});}
}
