import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {assertTradingEnabled} from '@/lib/trading-controls';

export async function GET(){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers:{'Cache-Control':'no-store'}});
 if(!env.DB)return Response.json({error:'Workspace storage unavailable.'},{status:503,headers:{'Cache-Control':'no-store'}});
 try{await assertTradingEnabled(env.DB,env);return Response.json({enabled:true},{headers:{'Cache-Control':'no-store'}});}
 catch(error){return Response.json({error:error instanceof Error?error.message:'Trading is paused.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
