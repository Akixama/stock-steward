import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {ownerActivity} from '@/db/activity';

const headers={'Cache-Control':'no-store'};

// Read-only: lists the signed-in owner's real buys, sales, sends and ideas.
export async function GET(){
  const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
  if(!env.DB)return Response.json({error:'Activity is unavailable.'},{status:503,headers});
  try{return Response.json({items:await ownerActivity(env.DB,user.userId)},{headers});}
  catch{return Response.json({error:'Activity could not load.'},{status:503,headers});}
}
