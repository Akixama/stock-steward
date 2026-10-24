import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getSessionGrant} from '@/db/autonomous-grants';
import {loadGuard,saveGuardSettings} from '@/db/panic-guard';
import {coolingUntil} from '@/lib/panic-guard';
import {readBoundedText} from '@/lib/strategy-ai-server';
const headers={'Cache-Control':'no-store'};
export async function GET(){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(!env.DB)return Response.json({error:'Unavailable.'},{status:503,headers});
 try{const grant=await getSessionGrant(env.DB,user.userId),g=await loadGuard(env.DB,user.userId,grant?.id);return Response.json({settings:g.settings,state:g.state,coolingUntil:coolingUntil(g.state,Date.now())},{headers});}
 catch{return Response.json({error:'Panic guard unavailable.'},{status:503,headers});}
}
export async function PUT(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(!env.DB)return Response.json({error:'Unavailable.'},{status:503,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 // Loosening the guard never ends a cool-off already running.
 try{return Response.json({settings:await saveGuardSettings(env.DB,user.userId,JSON.parse(await readBoundedText(request,500)))},{headers});}
 catch(e){return Response.json({error:e instanceof Error?e.message:'Invalid settings.'},{status:400,headers});}
}
