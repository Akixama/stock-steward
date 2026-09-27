import {chainTransport} from '@/lib/chain-transport';
import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';
import { D1DecisionLedger } from '@/db/ledger';
import { claimChainRead } from '@/db/chain-observations';
import { listAutonomyRuns, saveAutonomyRun } from '@/db/autonomy';
import { autonomyReadiness, readInfrastructure, attachHistoricalControl } from '@/lib/autonomy';
import {getOwnership} from '@/db/wallet-ownership';
import {walletProfile} from '@/lib/wallet-profile';
const headers={'Cache-Control':'no-store'};
export async function GET() {
  const user=await getChatGPTUser();
  if (!user) return Response.json({error:'Sign in first.'},{status:401,headers});
  if (!env.DB) return Response.json({error:'Storage unavailable.'},{status:503,headers});
  try { return Response.json({runs:await listAutonomyRuns(env.DB,user.userId)},{headers}); }
  catch { return Response.json({error:'Autonomy history unavailable.'},{status:503,headers}); }
}
export async function POST(request:Request) {
  const user=await getChatGPTUser();
  if (!user) return Response.json({error:'Sign in first.'},{status:401,headers});
  if (!env.DB) return Response.json({error:'Storage unavailable.'},{status:503,headers});
  if (request.headers.get('origin')!==new URL(request.url).origin) return Response.json({error:'Invalid origin.'},{status:403,headers});
  const text=await request.text();
  if (text.length>200) return Response.json({error:'Request too large.'},{status:413,headers});
  let address:unknown;
  try { address=JSON.parse(text).address; } catch { address=null; }
  if (typeof address!=='string' || !/^0x[0-9a-f]{40}$/i.test(address)) return Response.json({error:'Enter a valid public wallet address.'},{status:400,headers});
  try {
    if (!await claimChainRead(env.DB,user.userId)) return Response.json({error:'Wait 15 seconds between wallet and autonomy checks.'},{status:429,headers:{...headers,'Retry-After':'15'}});
    const mandate=await new D1DecisionLedger(env.DB).getMandate(user.userId);
    let infrastructure=null;
    try { infrastructure=await readInfrastructure(chainTransport(env.ALCHEMY_API_KEY)); } catch { /* Save an honest blocked receipt even during provider outages. */ }
    const receipt=autonomyReadiness(address,mandate,infrastructure);
    receipt.walletProfile=await walletProfile(address,chainTransport(env.ALCHEMY_API_KEY),infrastructure?.block);
    const ownership=await getOwnership(env.DB,user.userId);
    attachHistoricalControl(receipt,ownership);
    await saveAutonomyRun(env.DB,user.userId,receipt);
    return Response.json({receipt},{headers});
  } catch { return Response.json({error:'Could not persist the autonomy check. No execution occurred.'},{status:503,headers}); }
}
