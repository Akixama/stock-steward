import {dueAgents,claimAgent,logAgentDecision,type AgentRow} from '../db/ai-agent.ts';
import {getShadowPlan,saveShadowPlan,controlShadowPlan} from '../db/autonomous-shadow.ts';
import {getSessionGrant} from '../db/autonomous-grants.ts';
import {getActivation} from '../db/autonomous-controls.ts';
import {getOwnership} from '../db/wallet-ownership.ts';
import {D1DecisionLedger} from '../db/ledger.ts';
import {marketHistory} from './market-chart.ts';
import {readChain} from './robinhood-chain.ts';
import {AGENT_PROMPT,agentInput,agentRule,priceChanges,reviewAgentDecision,validateAgentSettings,type AgentDecision,type AgentMarket,type AgentSettings} from './ai-agent.ts';
import type {RolesPolicy} from './roles-permission.ts';
import {saveInboxItem} from '../db/notification-inbox.ts';

export const AGENT_RULE_ID='agent';
const FRESH_MS=30*60_000;
export type Holdings={cashCents:number;held:Record<string,{quantity:number;token:string}>};
export type AgentDeps={ask(system:string,user:string):Promise<unknown>;holdings(account:string):Promise<Holdings>;maxOrderCents:number;now?:Date};

export async function chainHoldings(account:string,fetcher:typeof fetch=fetch):Promise<Holdings>{
 const o=await readChain(account,fetcher);
 return {cashCents:Math.floor(Number(o.usdg??'0')*100),held:Object.fromEntries(o.holdings.filter(h=>h.quantity!==null).map(h=>[h.symbol,{quantity:Number(h.quantity),token:h.contract.toLowerCase()}]))};
}

// Every hold pauses the agent's one-shot rule, so nothing it decided earlier can run again.
async function park(db:D1Database,owner:string,now:Date){
 const plan=await getShadowPlan(db,owner,AGENT_RULE_ID);
 if(plan?.enabled===1)await controlShadowPlan(db,owner,plan.revision,false,now,AGENT_RULE_ID);
}

export async function runAgent(db:D1Database,row:AgentRow,settings:AgentSettings,deps:AgentDeps):Promise<AgentDecision|null>{
 const now=deps.now??new Date(),owner=row.owner_ref;
 // Auto mode needs armed automatic mode; Ask-me mode only a verified wallet.
 // Otherwise: no AI call, nothing logged, rule parked.
 const mode=settings.mode??'auto';
 const ownership=await getOwnership(db,owner),grant=await getSessionGrant(db,owner);
 const armed=!!ownership?.verifiedAt&&grant?.state==='verified'&&(await getActivation(db,owner,grant.id))?.state==='armed';
 if(!ownership?.verifiedAt||(mode==='auto'&&!armed)){await park(db,owner,now);return null;}
 const mandate=await new D1DecisionLedger(db).getMandate(owner);if(!mandate){await park(db,owner,now);return null;}
 const live=validateAgentSettings({...settings,symbols:settings.symbols.filter(s=>mandate.allowedSymbols.includes(s))},mandate.allowedSymbols);
 let policy:RolesPolicy|null=null;try{policy=grant?.state==='verified'?JSON.parse(grant.policy_json) as RolesPolicy:null;}catch{policy=null;}
 const holdings=await deps.holdings(policy?.account??ownership.address);
 const saleTokens=new Set((policy?.sales??[]).map(s=>s.token.toLowerCase()));
 const market:AgentMarket[]=[];
 for(const symbol of live.symbols){
  const samples=await marketHistory(db,symbol,8),last=samples[samples.length-1];
  const fresh=!!last&&now.getTime()-Date.parse(last.observedAt)<=FRESH_MS;
  const h=holdings.held[symbol];
  market.push({symbol,bidCents:fresh?last.bidCents:0,askCents:fresh?last.askCents:0,...priceChanges(samples),heldCents:fresh&&h?Math.floor(h.quantity*last.bidCents):0});
 }
 // Ask-me: you sign each sale yourself, so anything held is sellable.
 const sellable=live.symbols.filter(s=>holdings.held[s]&&(mode==='ask'||saleTokens.has(holdings.held[s].token)));
 const ctx={cashCents:holdings.cashCents,lotCents:mode==='ask'?Math.min(mandate.maxOrderCents,100000):Math.min(mandate.maxOrderCents,deps.maxOrderCents),sellable};
 let decision:AgentDecision;
 try{decision=reviewAgentDecision(await deps.ask(AGENT_PROMPT,agentInput(live,market,ctx)),live,market,ctx,now);}
 catch{decision={action:'hold',symbol:null,amountCents:0,reason:'The AI could not be reached, so the agent held.',at:now.toISOString(),blocked:'AI unavailable'};}
 decision={...decision,mode};
 if(decision.action==='hold')await park(db,owner,now);
 else if(mode==='ask'&&decision.action==='sell'){
  // Sells in Ask-me mode go to your inbox; you sell from Home with your wallet.
  await park(db,owner,now);
  await saveInboxItem(db,owner,{id:`agent:${decision.at}`,kind:'price',title:`Steward agent: sell idea for ${decision.symbol}`,body:`Sell about $${(decision.amountCents/100).toFixed(2)} of ${decision.symbol}. ${decision.reason} Open Sell on Home to review it; only your wallet signature can place it.`.slice(0,500),symbol:decision.symbol,created_at:decision.at});
 }
 else{
  const plan=await getShadowPlan(db,owner,AGENT_RULE_ID);
  try{if(!await saveShadowPlan(db,owner,plan?.revision??0,agentRule(decision),true,now,AGENT_RULE_ID))throw Error('changed');}
  catch(e){decision={...decision,action:'hold',amountCents:0,blocked:String(e).includes('RULE_LIMIT')?'You have 6 rules; remove one so the agent has room':'Could not queue the trade'};await park(db,owner,now);}
 }
 await logAgentDecision(db,owner,decision);
 return decision;
}

export async function tickAgents(db:D1Database,deps:AgentDeps){
 const now=deps.now??new Date(),summary={due:0,buys:0,sells:0,holds:0,skipped:0,failed:0};
 for(const row of await dueAgents(db,now)){
  summary.due++;
  let settings:AgentSettings;
  try{settings=JSON.parse(row.settings_json) as AgentSettings;}catch{summary.failed++;continue;}
  if(!await claimAgent(db,row,settings.intervalMinutes,now))continue;
  try{
   const d=await runAgent(db,row,settings,{...deps,now});
   if(!d)summary.skipped++;else if(d.action==='buy')summary.buys++;else if(d.action==='sell')summary.sells++;else summary.holds++;
  }catch{summary.failed++;await park(db,row.owner_ref,now).catch(()=>{});}
 }
 return summary;
}
