import {z} from 'zod';
import type {AutonomousRule} from './autonomous-live.ts';
// Steward agent: the AI DECIDES what to buy or sell and when. Deterministic code
// then DISPOSES: every decision must name a stock in the agent's list, fit the
// owner's Limits and the signed permission, and pass the style's no-chasing rule.
// An approved decision becomes a one-shot rule that runs through the same
// execution path as every other automatic trade (Panic guard, gas, caps, the
// on-chain permission). The AI never sees addresses and never builds a transaction.
export type AgentStyle='careful'|'balanced'|'bold';
export const AGENT_INTERVALS=[15,30,60,240] as const;
// mode: 'auto' = the agent trades through the signed permission; 'ask' = it proposes
// and the owner approves each trade with a wallet signature (no permission needed).
export type AgentMode='auto'|'ask';
export type AgentSettings={version:1;symbols:string[];style:AgentStyle;intervalMinutes:(typeof AGENT_INTERVALS)[number];note:string;mode?:AgentMode};
export type AgentMarket={symbol:string;bidCents:number;askCents:number;change1dBps:number|null;change7dBps:number|null;heldCents:number};
export type AgentDecision={action:'buy'|'sell'|'hold';symbol:string|null;amountCents:number;reason:string;at:string;blocked?:string;mode?:AgentMode;priceCents?:number};
export const MAX_AGENT_SYMBOLS=6;
// The biggest one-day rise each style will still buy into. Careful never chases.
export const CHASE_LIMIT_BPS:Record<AgentStyle,number|null>={careful:500,balanced:1500,bold:null};

export function validateAgentSettings(s:AgentSettings,allowed:string[]):AgentSettings{
 if(!s||s.version!==1||(s.mode!==undefined&&!['auto','ask'].includes(s.mode))||!['careful','balanced','bold'].includes(s.style)||!(AGENT_INTERVALS as readonly number[]).includes(s.intervalMinutes)||typeof s.note!=='string'||s.note.length>280||!Array.isArray(s.symbols)||s.symbols.length<1||s.symbols.length>MAX_AGENT_SYMBOLS)throw Error('Choose 1 to 6 stocks, a style and how often the agent checks.');
 const symbols=[...new Set(s.symbols.map(x=>String(x).toUpperCase()))];
 if(symbols.length!==s.symbols.length||symbols.some(x=>!/^[A-Z][A-Z0-9.]{0,7}$/.test(x)||!allowed.includes(x)))throw Error('The agent can only trade stocks in your Limits.');
 return {version:1,symbols,style:s.style,intervalMinutes:s.intervalMinutes,note:s.note.replace(/[\u0000-\u001f]/g,' ').trim(),mode:s.mode??'auto'};
}

export const AGENT_PROMPT=`You are Steward, an autonomous trading agent for one investor on Robinhood Chain stock tokens.
Every check you choose exactly one action: "buy" one fixed-size lot of one listed stock, "sell" one fixed-size lot of a stock marked sellable, or "hold".
Style: careful = buy only on real weakness, prefer holding; balanced = buy dips in good trends, take profit after strong runs; bold = act more often, still never all-in.
Rules: use only listed symbols. Never buy if cash is below the lot size. Never sell a stock that is not sellable or not held. Do not chase a big one-day rise.
Holding is a good answer when nothing is clearly attractive. Follow the investor's note when it does not break these rules.
reason: one plain sentence a beginner understands, citing the numbers given. No hype, no promises.
Return JSON: {"action":"buy"|"sell"|"hold","symbol":string|null,"reason":string}`;

export function agentInput(settings:AgentSettings,market:AgentMarket[],ctx:{cashCents:number;lotCents:number;sellable:string[]}){
 const pct=(b:number|null)=>b===null?null:Math.round(b)/100;
 return JSON.stringify({style:settings.style,investorNote:settings.note||null,cashUsd:ctx.cashCents/100,buyLotUsd:ctx.lotCents/100,
  stocks:market.map(m=>({symbol:m.symbol,priceUsd:m.askCents/100,change1dPercent:pct(m.change1dBps),change7dPercent:pct(m.change7dBps),heldUsd:m.heldCents/100,sellable:ctx.sellable.includes(m.symbol)&&m.heldCents>0}))});
}

const raw=z.object({action:z.enum(['buy','sell','hold']),symbol:z.string().max(12).nullable().optional(),reason:z.string().max(400)});

// The disposer. Anything the AI says that does not fit becomes a visible hold.
export function reviewAgentDecision(output:unknown,settings:AgentSettings,market:AgentMarket[],ctx:{cashCents:number;lotCents:number;sellable:string[]},now=new Date()):AgentDecision{
 const at=now.toISOString(),hold=(reason:string,blocked?:string,symbol:string|null=null):AgentDecision=>({action:'hold',symbol,amountCents:0,reason:reason.slice(0,300),at,...(blocked?{blocked}:{})});
 const parsed=raw.safeParse(output);if(!parsed.success)return hold('The agent gave an unreadable answer, so it held.','Unreadable AI answer');
 const d=parsed.data,reason=d.reason.replace(/\s+/g,' ').trim()||'No reason given.';
 if(d.action==='hold')return hold(reason);
 const symbol=(d.symbol??'').toUpperCase(),m=market.find(x=>x.symbol===symbol);
 if(!m||!settings.symbols.includes(symbol))return hold(reason,'Picked a stock outside your agent list');
 if(!(m.askCents>0&&m.bidCents>0))return hold(reason,'No fresh price',symbol);
 if(d.action==='buy'){
  if(ctx.lotCents<1||ctx.cashCents<ctx.lotCents)return hold(reason,'Not enough USDG for one buy',symbol);
  const chase=CHASE_LIMIT_BPS[settings.style];
  if(chase!==null&&m.change1dBps!==null&&m.change1dBps>chase)return hold(reason,`Up ${(m.change1dBps/100).toFixed(1)}% today; ${settings.style} style does not chase`,symbol);
  return {action:'buy',symbol,amountCents:ctx.lotCents,reason:reason.slice(0,300),at,priceCents:m.askCents};
 }
 if(!ctx.sellable.includes(symbol))return hold(reason,'Your permission has no sale for this stock',symbol);
 if(m.heldCents<=0)return hold(reason,'You do not hold this stock',symbol);
 return {action:'sell',symbol,amountCents:Math.min(ctx.lotCents,m.heldCents),reason:reason.slice(0,300),at,priceCents:m.bidCents};
}

// Changes from saved prices: last vs the first sample at least 1 / 7 days old.
export function priceChanges(samples:{observedAt:string;bidCents:number}[]){
 const s=samples.filter(x=>x.bidCents>0).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));if(s.length<2)return {change1dBps:null,change7dBps:null};
 const last=s[s.length-1],t=Date.parse(last.observedAt);
 const since=(days:number)=>{const base=[...s].reverse().find(x=>t-Date.parse(x.observedAt)>=days*86400000*0.9);return base?Math.round((last.bidCents-base.bidCents)*10000/base.bidCents):null;};
 return {change1dBps:since(1),change7dBps:since(7)};
}

// An approved decision becomes a one-shot strategy rule. The long interval means
// the executor will not repeat it; the agent rewrites or pauses it every check.
export function agentRule(d:AgentDecision):AutonomousRule{
 if(d.action==='hold'||!d.symbol||d.amountCents<1)throw Error('Only a buy or sell becomes a rule.');
 const kind=d.action==='buy'?'scheduled' as const:'sell_scheduled' as const;
 return {version:1,symbol:d.symbol,amountCents:d.amountCents,kind,intervalMinutes:1440,thresholdCents:1,
  strategy:{version:1,kind,direction:`Steward agent: ${d.reason}`.slice(0,1500),symbol:d.symbol,amountCents:d.amountCents,reserveCents:0,intervalHours:1,thresholdCents:1,targetBps:5000,driftBps:100,maxMovementBps:100,mode:'automatic'}};
}

// Report card: was each buy or sell call right so far? A buy is right if the
// price is higher now, a sell if it is lower. Calls under an hour old are not scored.
export function agentScore(log:AgentDecision[],latestCents:Record<string,number>,now=Date.now()){
 let calls=0,right=0,moveBps=0;
 for(const d of log){
  if(d.action==='hold'||!d.symbol||!d.priceCents||now-Date.parse(d.at)<3600_000)continue;
  const p=latestCents[d.symbol];if(!p)continue;
  const move=Math.round((p-d.priceCents)*10000/d.priceCents),signed=d.action==='buy'?move:-move;
  calls++;if(signed>0)right++;moveBps+=signed;
 }
 return {calls,right,averageEdgeBps:calls?Math.round(moveBps/calls):null};
}
