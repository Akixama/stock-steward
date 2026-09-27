import {env} from 'cloudflare:workers';import {getChatGPTUser} from '@/app/chatgpt-auth';import {z} from 'zod';import {claimAIRequest} from '@/db/strategy-ai-usage';import {aiConfigured,interpretOnServer,readBoundedText} from '@/lib/strategy-ai-server';import {reviewInterpretation} from '@/lib/strategy-interpretation';import {validateStrategy,type Strategy} from '@/lib/strategy';
const headers={'Cache-Control':'no-store'};
const requestSchema=z.object({direction:z.string().trim().min(1).max(1500),base:z.object({version:z.number(),kind:z.enum(['scheduled','threshold','allocation','accumulate']),direction:z.string().max(1500),symbol:z.string().max(8),amountCents:z.number(),reserveCents:z.number(),intervalHours:z.number(),thresholdCents:z.number(),targetBps:z.number(),driftBps:z.number(),maxMovementBps:z.number(),mode:z.enum(['approval','automatic'])}).strict()}).strict();
export async function GET(){const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});return Response.json({available:aiConfigured(env)&&!!env.DB},{headers});}
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 let input;try{input=requestSchema.parse(JSON.parse(await readBoundedText(request,10000)));validateStrategy(input.base as Strategy);}catch{return Response.json({error:'Check your direction and draft fields, then try again.'},{status:400,headers});}
 if(!aiConfigured(env)||!env.DB)return Response.json({error:'AI interpretation is not available yet. You can set the rules below.'},{status:503,headers});
 try{if(!await claimAIRequest(env.DB,user.userId))return Response.json({error:'AI request limit reached. Wait 15 seconds; daily limits reset at midnight UTC. You can still set rules manually.'},{status:429,headers});const result=await interpretOnServer(input.direction,env);const review=reviewInterpretation(result,input.direction,input.base as Strategy);return Response.json({review},{headers});}
 catch{return Response.json({error:'AI could not produce valid rules right now. Clarify your direction or set the fields manually. Nothing was activated.'},{status:503,headers});}
}
