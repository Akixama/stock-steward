import {V3_EXTRAS} from '@/lib/product-flags';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getSessionGrant} from '@/db/autonomous-grants';
import {claimChainRead} from '@/db/chain-observations';
import {D1DecisionLedger} from '@/db/ledger';
import {chainTransport} from '@/lib/chain-transport';
import {registry} from '@/lib/robinhood-chain';
import {buildAttacks,runWallTest,stewardChecks} from '@/lib/stress-test';
import type {RolesPolicy} from '@/lib/roles-permission';
import type {Address} from 'viem';
const headers={'Cache-Control':'no-store'};
// Read-only: every attack is an eth_call. Nothing is signed or sent.
export async function POST(request:Request){
 if(!V3_EXTRAS)return Response.json({error:'Not available.'},{status:404,headers:{'Cache-Control':'no-store'}});
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 if(!env.DB)return Response.json({error:'Unavailable.'},{status:503,headers});
 try{
  const [grant,mandate]=await Promise.all([getSessionGrant(env.DB,user.userId),new D1DecisionLedger(env.DB).getMandate(user.userId)]);
  if(!mandate)return Response.json({error:'Save your Limits first.'},{status:409,headers});
  if(!await claimChainRead(env.DB,user.userId))return Response.json({error:'Please wait 15 seconds between checks.'},{status:429,headers});
  let offList:{symbol:string;token:Address}|null=null;
  try{const r=await fetch('https://api.robinhood.com/rhj/assets',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(r.ok){const found=registry(await r.json()).find(a=>a.status==='ASSET_STATUS_ACTIVE'&&!mandate.allowedSymbols.includes(a.symbol));if(found)offList={symbol:found.symbol,token:found.contract as Address};}}catch{offList=null;}
  const steward=stewardChecks(mandate,offList?.symbol??null);
  if(!grant||grant.state!=='verified')return Response.json({steward,wall:[],permissionActive:false},{headers});
  const policy=JSON.parse(grant.policy_json) as RolesPolicy;
  const wall=await runWallTest(policy,buildAttacks(policy,offList?.token??null),chainTransport(env.ALCHEMY_API_KEY));
  return Response.json({steward,wall,permissionActive:true,checkedAt:new Date().toISOString()},{headers});
 }catch{return Response.json({error:'Stress test unavailable right now. Nothing was sent.'},{status:503,headers});}
}
