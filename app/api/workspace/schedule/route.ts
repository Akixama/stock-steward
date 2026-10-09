import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getSchedule,scheduleRuns,setSchedule,controlSchedule} from '@/db/scheduler';
const headers={'Cache-Control':'no-store'};
export async function GET(){
  const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
  if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});
  try{
    const schedule=await getSchedule(env.DB,user.userId);
    const health=await env.DB.prepare("SELECT last_started_at,last_completed_at,last_summary FROM autonomy_worker_health WHERE id='monitor'").first();
    const safeSchedule=schedule ? {...schedule,owner_ref:undefined,lease_token:undefined}:null;
    return Response.json({schedule:safeSchedule,runs:await scheduleRuns(env.DB,user.userId),workerConfigured:!!env.STEWARD_WORKER_KEY&&env.STEWARD_RUNNER_ENABLED==='true',health},{headers});
  }catch{return Response.json({error:'Monitoring status unavailable.'},{status:503,headers});}
}
export async function POST(request:Request){
  const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
  if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});
  const text=await request.text();if(text.length>400)return Response.json({error:'Request too large.'},{status:413,headers});
  let body:{action?:unknown;revision?:unknown;address?:unknown;interval?:unknown};try{body=JSON.parse(text);}catch{return Response.json({error:'Invalid request.'},{status:400,headers});}
  if(!body||!Number.isSafeInteger(body.revision)||Number(body.revision)<0||typeof body.action!=='string'||!['start','pause','resume'].includes(body.action))return Response.json({error:'Invalid schedule action.'},{status:400,headers});
  if(body.action==='start'&&(typeof body.address!=='string'||!/^0x[0-9a-f]{40}$/i.test(body.address)||![15,30,60,240,1440].includes(Number(body.interval))))return Response.json({error:'Use a valid public address and supported monitoring interval.'},{status:400,headers});
  if(body.action!=='pause'&&(!env.STEWARD_WORKER_KEY||env.STEWARD_RUNNER_ENABLED!=='true'))return Response.json({error:'The background runner is not configured. Monitoring cannot start yet.'},{status:503,headers});
  try{
    const changed=body.action==='start'?await setSchedule(env.DB,user.userId,body.address as string,Number(body.interval),Number(body.revision)):
      await controlSchedule(env.DB,user.userId,Number(body.revision),body.action==='resume');
    if(!changed)return Response.json({error:'Schedule changed elsewhere. Reload status before trying again.'},{status:409,headers});
    return Response.json({saved:true},{headers});
  }catch{return Response.json({error:'Could not save monitoring controls.'},{status:503,headers});}
}
