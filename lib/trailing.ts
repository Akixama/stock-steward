import type {AutonomousRule} from './autonomous-live.ts';
// Trailing stop: "sell if it falls X% from its highest price since I set this".
// Stored as a stop-loss (sell_below) plus trailBps/trailSince. At every check
// the stop price is recomputed from the highest saved bid since trailSince,
// then the rule runs through the normal stop-loss path and all its checks.
export const TRAIL_OPTIONS=[300,500,800,1000,1500,2000] as const; // 3%..20%
export function trailingStop(highCents:number,trailBps:number){
 if(!Number.isSafeInteger(highCents)||highCents<1||!Number.isSafeInteger(trailBps)||trailBps<100||trailBps>5000)throw Error('Invalid trailing stop.');
 return Math.max(1,Math.floor(highCents*(10000-trailBps)/10000));
}
export function applyTrailing(rule:AutonomousRule,highCents:number):AutonomousRule{
 if(!rule.trailBps)return rule;
 const thresholdCents=trailingStop(highCents,rule.trailBps);
 return {...rule,thresholdCents,...(rule.strategy?{strategy:{...rule.strategy,thresholdCents}}:{})};
}
export async function trailingHigh(db:D1Database,symbol:string,since:string,currentCents?:number|null):Promise<number|null>{
 const row=await db.prepare('SELECT MAX(bid_cents) AS high FROM market_price_samples WHERE symbol=? AND observed_at>=?').bind(symbol,since).first<{high:number|null}>();
 const high=Math.max(row?.high??0,currentCents??0);
 return high>0?high:null;
}
// Resolves a stored rule into the rule to evaluate right now.
export async function resolveRule(db:D1Database,rule:AutonomousRule):Promise<AutonomousRule>{
 if(!rule.trailBps)return rule;
 const high=await trailingHigh(db,rule.symbol,rule.trailSince!);
 if(!high)throw Error('No saved prices yet for this trailing stop.');
 return applyTrailing(rule,high);
}
