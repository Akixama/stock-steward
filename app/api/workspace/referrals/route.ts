import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {leaderboard,referralSummary,setReferralName} from '@/db/referrals';
import {readBoundedText} from '@/lib/strategy-ai-server';
const headers={'Cache-Control':'no-store'};
export async function GET(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(!env.DB)return Response.json({error:'Referrals are unavailable.'},{status:503,headers});
 try{const summary=await referralSummary(env.DB,user.userId);const link=new URL(`/r/${summary.code}`,request.url).toString();return Response.json({...summary,link,top:await leaderboard(env.DB,5,user.userId)},{headers});}
 catch{return Response.json({error:'Referrals are temporarily unavailable. Try again.'},{status:503,headers});}
}
export async function PUT(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(!env.DB)return Response.json({error:'Referrals are unavailable.'},{status:503,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 let name:unknown;try{name=(JSON.parse(await readBoundedText(request,500)) as {name?:unknown}).name;}catch{return Response.json({error:'Send a name.'},{status:400,headers});}
 try{return Response.json({displayName:await setReferralName(env.DB,user.userId,name??null)},{headers});}
 catch(e){const m=e instanceof Error?e.message:'';return Response.json({error:m==='NAME_TAKEN'?'That name is taken. Try another.':m==='INVALID_NAME'?'Use 2 to 20 letters, numbers, spaces, dots, dashes or underscores.':'Could not save your name.'},{status:m?400:503,headers});}
}
