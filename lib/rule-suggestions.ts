import {z} from 'zod';
import {replayRule,type ReplayRule,type ReplaySample,type ReplayResult} from './replay.ts';
// "Steward suggests": the AI may only PROPOSE rules. Every suggestion is
// validated here against the owner's Limits and sanity bounds, replayed on
// real saved prices, and can only be added as a PAUSED rule by the owner.
export type MarketContext={symbol:string;lastCents:number;change7dPct:number|null;high30dCents:number;low30dCents:number;samples:ReplaySample[]};
export type Suggestion={rule:ReplayRule;reason:string;replay:ReplayResult|null};
const KINDS=['threshold','scheduled','sell_below','sell_threshold','sell_trailing'] as const;
const raw=z.object({suggestions:z.array(z.object({kind:z.enum(KINDS),symbol:z.string().max(8),amountUsd:z.number().positive().max(100000),priceUsd:z.number().positive().max(1000000).nullable().optional(),trailPercent:z.number().min(1).max(50).nullable().optional(),checkMinutes:z.number().int().min(1).max(1440).optional(),reason:z.string().min(1).max(400)}).passthrough()).max(6)}).passthrough();

export function contextFor(symbol:string,samples:ReplaySample[]):MarketContext|null{
 const s=samples.filter(x=>x.bidCents>0&&x.askCents>0).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt));if(s.length<2)return null;
 const last=s[s.length-1],weekAgo=Date.parse(last.observedAt)-7*86400000,base=s.find(x=>Date.parse(x.observedAt)>=weekAgo)??s[0];
 return {symbol,lastCents:last.bidCents,change7dPct:base.bidCents?Math.round((last.bidCents-base.bidCents)/base.bidCents*1000)/10:null,high30dCents:Math.max(...s.map(x=>x.bidCents)),low30dCents:Math.min(...s.map(x=>x.bidCents)),samples:s};
}

export const SUGGESTION_PROMPT=`You help a careful investor set rules for a stock guardrail app. You never trade and never promise returns.
Given the investor's allowed stocks with recent prices, their per-buy limit and their existing rules, propose at most 3 NEW rules that fit
these stocks' recent behaviour. Rule kinds: "threshold" (buy when the ask drops to priceUsd or lower), "scheduled" (buy regularly),
"sell_below" (stop-loss at priceUsd), "sell_threshold" (take profit at priceUsd), "sell_trailing" (sell if it falls trailPercent from its high).
Use only the listed symbols. amountUsd must not exceed the per-buy limit. Prefer modest, defensive ideas. Do not repeat an existing rule.
reason: one plain sentence a beginner understands, citing the price facts given (no hype, no guarantees).
Return JSON: {"suggestions":[{"kind","symbol","amountUsd","priceUsd"|null,"trailPercent"|null,"checkMinutes","reason"}]}`;

export function suggestionInput(markets:MarketContext[],limits:{maxOrderCents:number;maxDailyBuyCents:number},existing:string[]){
 return JSON.stringify({perBuyLimitUsd:limits.maxOrderCents/100,dailyLimitUsd:limits.maxDailyBuyCents/100,existingRules:existing.slice(0,6),
  stocks:markets.map(m=>({symbol:m.symbol,priceUsd:m.lastCents/100,change7dPercent:m.change7dPct,high30dUsd:m.high30dCents/100,low30dUsd:m.low30dCents/100}))});
}

export function reviewSuggestions(output:unknown,markets:MarketContext[],limits:{maxOrderCents:number;maxDailyBuyCents:number},existing:ReplayRule[]):Suggestion[]{
 const parsed=raw.safeParse(output);if(!parsed.success)throw Error('AI_SCHEMA');
 const bySymbol=new Map(markets.map(m=>[m.symbol,m]));const out:Suggestion[]=[];const seen=new Set(existing.map(key));
 for(const s of parsed.data.suggestions){
  const m=bySymbol.get(s.symbol.toUpperCase());if(!m)continue;
  const amountCents=Math.min(Math.round(s.amountUsd*100),limits.maxOrderCents);if(amountCents<1)continue;
  const sell=s.kind!=='threshold'&&s.kind!=='scheduled';
  let thresholdCents=1,trailBps:number|undefined;
  if(s.kind==='sell_trailing'){const t=Math.round((s.trailPercent??0)*100);if(t<300||t>2000)continue;trailBps=[300,500,800,1000,1500,2000].reduce((a,b)=>Math.abs(b-t)<Math.abs(a-t)?b:a);}
  else if(s.kind!=='scheduled'){
   if(!s.priceUsd)continue;thresholdCents=Math.round(s.priceUsd*100);
   // Sanity: a trigger must sit within 30% of today's price, on the right side.
   if(thresholdCents<m.lastCents*0.7||thresholdCents>m.lastCents*1.3)continue;
   if(s.kind==='threshold'&&thresholdCents>=m.lastCents)continue;
   if(s.kind==='sell_below'&&thresholdCents>=m.lastCents)continue;
   if(s.kind==='sell_threshold'&&thresholdCents<=m.lastCents)continue;
  }
  const interval=sell?([1,2,5,15,30,60].includes(s.checkMinutes??0)?s.checkMinutes!:5):([15,30,60,240,1440].includes(s.checkMinutes??0)?s.checkMinutes!:s.kind==='scheduled'?1440:15);
  const rule:ReplayRule={kind:s.kind,symbol:m.symbol,amountCents,thresholdCents,intervalMinutes:interval,...(trailBps?{trailBps}:{})};
  if(seen.has(key(rule)))continue;seen.add(key(rule));
  let replay:ReplayResult|null=null;try{replay=replayRule(rule,limits,m.samples);}catch{replay=null;}
  out.push({rule,reason:s.reason.trim().slice(0,240),replay});
  if(out.length>=3)break;
 }
 return out;
}
function key(r:ReplayRule){return `${r.kind}:${r.symbol}:${r.kind==='sell_trailing'?r.trailBps:r.kind==='scheduled'?'':r.thresholdCents}`;}
