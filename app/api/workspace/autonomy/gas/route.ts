import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getSessionGrant} from '@/db/autonomous-grants';
import {getFeeConsent} from '@/db/autonomous-controls';
import {chainTransport} from '@/lib/chain-transport';
import {gasStatus,sessionBalanceWei,ethUsdMicro} from '@/lib/session-gas';
const headers={'Cache-Control':'no-store'};
export async function GET(){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(!env.DB)return Response.json({error:'Unavailable.'},{status:503,headers});
 try{
  const grant=await getSessionGrant(env.DB,user.userId);if(!grant)return Response.json({gas:null},{headers});
  const fee=await getFeeConsent(env.DB,user.userId,grant.id);let maxFee=50;try{if(fee)maxFee=Number(JSON.parse(fee.consent_json).maxFeeCents)||50;}catch{maxFee=50;}
  const [balance,eth]=await Promise.all([sessionBalanceWei(grant.session_address,chainTransport(env.ALCHEMY_API_KEY)),ethUsdMicro()]);
  if(balance===null)return Response.json({error:'Could not read your gas balance right now.'},{status:503,headers});
  return Response.json({session:grant.session_address,gas:gasStatus(balance,eth,maxFee)},{headers});
 }catch{return Response.json({error:'Gas status unavailable.'},{status:503,headers});}
}
