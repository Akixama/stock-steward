import {simulateRouter} from '@/lib/router-simulation';
import {getOwnership} from '@/db/wallet-ownership';
import {routePrerequisites} from '@/lib/route-prerequisites';
import {chainTransport} from '@/lib/chain-transport';
import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {claimChainRead} from '@/db/chain-observations';
import {saveAutonomyRun} from '@/db/autonomy';
import {D1DecisionLedger} from '@/db/ledger';
import {inspectRoute} from '@/lib/chain-route';
import {autonomyReadiness,attachHistoricalControl} from '@/lib/autonomy';
const headers={'Cache-Control':'no-store'};
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401,headers});if(!env.DB)return Response.json({error:'Storage unavailable.'},{status:503,headers});if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Invalid origin.'},{status:403,headers});
 const text=await request.text();if(text.length>400)return Response.json({error:'Request too large.'},{status:413,headers});let b:{address?:unknown;symbol?:unknown;amount?:unknown;slippageBps?:unknown};try{b=JSON.parse(text);}catch{return Response.json({error:'Invalid request.'},{status:400,headers});}
 if(!b||typeof b.address!=='string'||!/^0x[0-9a-f]{40}$/i.test(b.address)||typeof b.symbol!=='string'||! /^[A-Z0-9.-]{1,12}$/.test(b.symbol)||typeof b.amount!=='string'||! /^(?:0|[1-9]\d{0,5})(?:\.\d{1,18})?$/.test(b.amount)||!Number.isInteger(b.slippageBps)||Number(b.slippageBps)<1||Number(b.slippageBps)>100)return Response.json({error:'Use a wallet address, symbol, exact USDG amount and slippage of 1–100 basis points.'},{status:400,headers});
 try{if(!await claimChainRead(env.DB,user.userId))return Response.json({error:'Wait 15 seconds between chain reads.'},{status:429,headers});const mandate=await new D1DecisionLedger(env.DB).getMandate(user.userId);
 const route=await inspectRoute(b.address,b.symbol,b.amount,Number(b.slippageBps),chainTransport(env.ALCHEMY_API_KEY));const receipt=autonomyReadiness(b.address,mandate,null);receipt.route=route;receipt.prerequisites=await routePrerequisites(route,mandate,chainTransport(env.ALCHEMY_API_KEY));if(route.best)receipt.routerSimulation=await simulateRouter(route,mandate?.version??null,receipt.prerequisites?.routerCodeHash??null,chainTransport(env.ALCHEMY_API_KEY));receipt.why='Route evidence saved. Wallet authority, full execution simulation, eligibility and fees remain unverified. No transaction was prepared or sent.';
 attachHistoricalControl(receipt,await getOwnership(env.DB,user.userId));
 await saveAutonomyRun(env.DB,user.userId,receipt);return Response.json({receipt},{headers});
 }catch{return Response.json({error:'Current route evidence unavailable. No liquidity conclusion or spending decision was made.'},{status:503,headers});}
}
