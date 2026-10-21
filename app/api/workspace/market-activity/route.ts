import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getOwnership} from '@/db/wallet-ownership';
import {D1DecisionLedger} from '@/db/ledger';
import {locateSafe} from '@/app/api/workspace/orders/live/_shared';
import {chainTransport} from '@/lib/chain-transport';
import {readChain} from '@/lib/robinhood-chain';
import {enrichObservation} from '@/lib/chain-analysis';
import {marketActivityRows} from '@/lib/market-activity';

// Owner-scoped, read-only evidence for Markets. A failed chain read never
// converts an unknown balance into zero or an unresolved order into a fill.
export async function GET(){
  const user=await getChatGPTUser();
  if(!user)return Response.json({error:'Sign in first.'},{status:401});
  if(!env.DB)return Response.json({error:'Workspace storage is unavailable.'},{status:503});
  try{
    const [ownership,mandate]=await Promise.all([getOwnership(env.DB,user.userId),new D1DecisionLedger(env.DB).getMandate(user.userId)]);
    if(!ownership?.verifiedAt||!mandate)return Response.json({wallet:null,holdings:[],activity:[]},{headers:{'Cache-Control':'no-store'}});
    const safe=await locateSafe(env.DB,user.userId);
    const [buys,sales,observation]=await Promise.all([
      env.DB.prepare("SELECT plan_json,amount_cents,state,transaction_hash,created_at FROM execution_attempts WHERE owner_ref=? AND address=? AND transaction_hash IS NOT NULL ORDER BY created_at DESC LIMIT 25").bind(user.userId,safe.safe.toLowerCase()).all(),
      env.DB.prepare("SELECT symbol,quantity,state,transaction_hash,created_at FROM wallet_action_attempts WHERE owner_ref=? AND safe=? AND kind='sell' AND transaction_hash IS NOT NULL ORDER BY created_at DESC LIMIT 25").bind(user.userId,safe.safe.toLowerCase()).all(),
      readChain(safe.safe,chainTransport(env.ALCHEMY_API_KEY)).then(value=>enrichObservation(value,mandate)).catch(()=>null),
    ]);
    return Response.json({wallet:safe.safe,holdings:observation?.holdings.map(holding=>({symbol:holding.symbol,quantity:holding.quantity,valueMicroUsd:observation.prices[holding.contract]?.valueMicroUsd??null}))??null,
      observedAt:observation?.observedAt??null,activity:marketActivityRows(buys.results??[],sales.results??[])},
      {headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Your market activity could not be checked. No order was sent.'},{status:503});}
}
