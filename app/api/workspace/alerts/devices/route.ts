import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {removeDevice,saveDevice,validPushSubscription} from '@/lib/web-push';
import {readBoundedText} from '@/lib/strategy-ai-server';

const headers={'Cache-Control':'no-store'};
export async function GET(){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 return Response.json({available:!!(env.DB&&env.STEWARD_VAPID_PUBLIC_KEY&&env.STEWARD_VAPID_PRIVATE_KEY),publicKey:env.STEWARD_VAPID_PUBLIC_KEY??null},{headers});
}
export async function PUT(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(!env.DB||!env.STEWARD_VAPID_PUBLIC_KEY||!env.STEWARD_VAPID_PRIVATE_KEY)return Response.json({error:'Device notifications are not available yet.'},{status:503,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 try{const subscription=JSON.parse(await readBoundedText(request,5000));if(!validPushSubscription(subscription))return Response.json({error:'Unsupported notification service.'},{status:400,headers});await saveDevice(env.DB,user.userId,subscription);return Response.json({saved:true},{headers});}
 catch(e){return Response.json({error:e instanceof Error?e.message:'Could not save device.'},{status:400,headers});}
}
export async function DELETE(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(!env.DB)return Response.json({error:'Device storage unavailable.'},{status:503,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 try{const body=JSON.parse(await readBoundedText(request,3000));if(typeof body?.endpoint!=='string'||body.endpoint.length>2048)return Response.json({error:'Invalid device.'},{status:400,headers});await removeDevice(env.DB,user.userId,body.endpoint);return Response.json({removed:true},{headers});}
 catch{return Response.json({error:'Could not remove device.'},{status:400,headers});}
}
