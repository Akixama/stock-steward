import type {Mandate} from './decision.ts';
export type Strategy={version:number;kind:'scheduled'|'threshold'|'allocation'|'accumulate'|'sell_threshold'|'rebalance';direction:string;symbol:string;amountCents:number;reserveCents:number;intervalHours:number;thresholdCents:number;targetBps:number;driftBps:number;maxMovementBps:number;mode:'approval'|'automatic'};
export type PracticeEvidence={now:number;quoteAt:number;cashCents:number;holdingsCents:Record<string,number>;pricesCents:Record<string,number>;previousPricesCents:Record<string,number>;spentDay:string;spentCents:number;lastFillAt:number|null;grant:boolean;shareUnitsNanos?:Record<string,string>;valuationEstimated?:boolean};
export type StrategyResult={status:'held'|'awaiting_approval'|'ready';why:string;checks:{name:string;passed:boolean;detail:string}[];symbol:string;amountCents:number;side:'buy'|'sell';strategyVersion:number;mandateVersion:number;observedAt:number;mode:'practice';evidence:PracticeEvidence};
export const utcDay=(now:number)=>new Date(now).toISOString().slice(0,10);
const SHARE_SCALE=1_000_000_000n;
function unitsForValue(cents:number,priceCents:number){if(!Number.isSafeInteger(cents)||cents<0||!Number.isSafeInteger(priceCents)||priceCents<1)throw Error('Invalid practice valuation.');return (BigInt(cents)*SHARE_SCALE+BigInt(priceCents)/2n)/BigInt(priceCents);}
function valueForUnits(units:bigint,priceCents:number){const cents=(units*BigInt(priceCents)+SHARE_SCALE/2n)/SHARE_SCALE;if(cents>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Practice value exceeds supported precision.');return Number(cents);}
function existingUnits(e:PracticeEvidence,symbol:string,priceCents:number){const saved=e.shareUnitsNanos?.[symbol];if(saved!==undefined){if(!/^\d{1,30}$/.test(saved))throw Error('Invalid practice share evidence.');return {units:BigInt(saved),estimated:e.valuationEstimated===true};}const value=e.holdingsCents[symbol]??0;return {units:unitsForValue(value,priceCents),estimated:e.valuationEstimated===true||value>0};}
function salePosition(e:PracticeEvidence,symbol:string,priceCents:number,amountCents:number){
 const position=e.holdingsCents[symbol]??0;
 const current=existingUnits(e,symbol,priceCents);
 const nextUnits=unitsForValue(Math.max(0,position-amountCents),priceCents);
 if(nextUnits>current.units)throw Error('Practice sale exceeds held shares.');
 return {nextUnits,proceedsCents:position-valueForUnits(nextUnits,priceCents)};
}
export function revaluePracticeHolding(e:PracticeEvidence,symbol:string,priceCents:number,previousPriceCents:number):PracticeEvidence{
 const {units,estimated}=existingUnits(e,symbol,previousPriceCents);
 return {...e,shareUnitsNanos:{...e.shareUnitsNanos,[symbol]:units.toString()},valuationEstimated:estimated,holdingsCents:{...e.holdingsCents,[symbol]:valueForUnits(units,priceCents)}};
}
export function validateStrategy(s:Strategy){
 if(!s||!['scheduled','threshold','allocation','accumulate','sell_threshold','rebalance'].includes(s.kind)||!['approval','automatic'].includes(s.mode)||!Number.isSafeInteger(s.version)||s.version<1||!/^([A-Z][A-Z0-9.]{0,7})$/.test(s.symbol)||typeof s.direction!=='string'||s.direction.length>1500)throw Error('Choose a supported strategy and a valid symbol.');
 for(const v of [s.amountCents,s.reserveCents,s.intervalHours,s.thresholdCents,s.targetBps,s.driftBps,s.maxMovementBps])if(!Number.isSafeInteger(v)||v<0)throw Error('Use finite, nonnegative values with at most two decimal places.');
 if(s.amountCents<1||s.amountCents>100000000||s.reserveCents>100000000||s.intervalHours<1||s.intervalHours>8760||s.thresholdCents<1||s.thresholdCents>100000000||s.targetBps<1||s.targetBps>10000||s.driftBps>10000||s.maxMovementBps>10000)throw Error('Strategy values are outside the supported ranges.');
 if(['allocation','rebalance'].includes(s.kind)&&s.driftBps>=s.targetBps)throw Error('The allocation drift band must be smaller than the target.');
 if(s.kind==='rebalance'&&s.targetBps+s.driftBps>10000)throw Error('The upper rebalancing band cannot exceed 100%.');
 return s;
}
export function evaluateStrategy(s:Strategy,m:Mandate,e:PracticeEvidence):StrategyResult{
 validateStrategy(s);const numbers=[e.now,e.quoteAt,e.cashCents,e.spentCents,...Object.values(e.holdingsCents),...Object.values(e.pricesCents),...Object.values(e.previousPricesCents)];
 if(numbers.some(v=>!Number.isSafeInteger(v)||v<0)||e.lastFillAt!==null&&(!Number.isSafeInteger(e.lastFillAt)||e.lastFillAt>e.now)||!Number.isSafeInteger(m.version)||m.version<1||[m.maxOrderCents,m.maxDailyBuyCents,m.maxPositionBps].some(v=>!Number.isSafeInteger(v)||v<1)||m.maxPositionBps>10000)throw Error('Complete practice evidence and saved limits are required.');
 const total=e.cashCents+Object.values(e.holdingsCents).reduce((a,b)=>a+b,0),position=e.holdingsCents[s.symbol]??0,price=e.pricesCents[s.symbol]??0,previous=e.previousPricesCents[s.symbol]??0;
 if(!Number.isSafeInteger(total))throw Error('Practice value exceeds supported precision.');
 const elapsed=e.lastFillAt===null||e.now-e.lastFillAt>=s.intervalHours*3600000;
 const belowTarget=total>0&&BigInt(position)*10000n<BigInt(total)*BigInt(s.targetBps-s.driftBps);
 const aboveTarget=total>0&&BigInt(position)*10000n>BigInt(total)*BigInt(s.targetBps+s.driftBps);
 const movementOkay=previous>0&&BigInt(Math.abs(price-previous))*10000n<=BigInt(previous)*BigInt(s.maxMovementBps);
 const side:StrategyResult['side']=s.kind==='sell_threshold'||s.kind==='rebalance'&&aboveTarget?'sell':'buy';
 const targetCents=Number((BigInt(total)*BigInt(s.targetBps)+5000n)/10000n);
 const amountCents=s.kind==='rebalance'?Math.min(s.amountCents,Math.abs(position-targetCents)):s.amountCents;
 const trigger=s.kind==='scheduled'?elapsed:s.kind==='threshold'?price>0&&price<=s.thresholdCents:s.kind==='allocation'?belowTarget:s.kind==='accumulate'?elapsed&&movementOkay:s.kind==='sell_threshold'?elapsed&&price>=s.thresholdCents:elapsed&&(belowTarget||aboveTarget);
 const triggerDetail=s.kind==='scheduled'?`At least ${s.intervalHours} hours between completed buys.`:s.kind==='threshold'?`Price must be at or below $${(s.thresholdCents/100).toFixed(2)}.`:s.kind==='allocation'?`Buy only below ${(s.targetBps-s.driftBps)/100}% allocation; no selling in this strategy.`:s.kind==='accumulate'?`Interval ${s.intervalHours} hours; price movement at most ${s.maxMovementBps/100}%.`:s.kind==='sell_threshold'?`Sell only at or above $${(s.thresholdCents/100).toFixed(2)}, at least ${s.intervalHours} hours after the last trade.`:`Trade only outside ${(s.targetBps-s.driftBps)/100}%–${(s.targetBps+s.driftBps)/100}%, at least ${s.intervalHours} hours after the last trade.`;
 const checks:StrategyResult['checks']=[];const add=(name:string,passed:boolean,detail:string)=>checks.push({name,passed,detail});
 add('Practice permission',e.grant,'Practice permission is separate from any live wallet grant.');
 add('Fresh price evidence',e.quoteAt<=e.now+10000&&e.now-e.quoteAt<=60000&&price>0,'Price quote must be no more than 60 seconds old.');
 add('Strategy trigger',trigger,triggerDetail);
 add('Allowed stock',m.allowedSymbols.includes(s.symbol),`${s.symbol}; allowed: ${m.allowedSymbols.join(', ')||'none'}.`);
 add('Order size',amountCents>0&&amountCents<=m.maxOrderCents,`Each practice trade must fit the $${(m.maxOrderCents/100).toFixed(2)} order cap.`);
 if(side==='buy'){
  const today=e.spentDay===utcDay(e.now)?e.spentCents:0;
  add('Daily buy budget',BigInt(today)+BigInt(amountCents)<=BigInt(m.maxDailyBuyCents),`Spent $${(today/100).toFixed(2)} of $${(m.maxDailyBuyCents/100).toFixed(2)} today.`);
  add('Cash reserve',e.cashCents-amountCents>=s.reserveCents,`Keep at least $${(s.reserveCents/100).toFixed(2)} after buying.`);
  add('Concentration',total>0&&(BigInt(position)+BigInt(amountCents))*10000n<=BigInt(total)*BigInt(m.maxPositionBps),`Maximum ${m.maxPositionBps/100}% of the simulated portfolio.`);
  if(s.kind==='allocation'||s.kind==='rebalance')add('Target ceiling',total>0&&(BigInt(position)+BigInt(amountCents))*10000n<=BigInt(total)*BigInt(s.targetBps),'The practice buy must not overshoot the target.');
 }else{
  add('Held shares',position>=amountCents&&amountCents>0,`At least $${(amountCents/100).toFixed(2)} of ${s.symbol} must be held before selling.`);
  add('Precise position',e.valuationEstimated!==true&&typeof e.shareUnitsNanos?.[s.symbol]==='string','Selling needs share quantities from a fresh practice run; older estimated holdings must be reset.');
 }
 const failure=checks.find(c=>!c.passed);
 return {status:failure?'held':s.mode==='approval'?'awaiting_approval':'ready',why:failure?failure.name+': '+failure.detail:s.mode==='approval'?`All checks passed. Exact practice ${side} awaits your approval.`:'All checks passed within the active practice permission.',checks,symbol:s.symbol,amountCents,side,strategyVersion:s.version,mandateVersion:m.version,observedAt:e.now,mode:'practice',evidence:structuredClone(e)};
}
export function practiceFill(result:StrategyResult,s:Strategy,m:Mandate,e:PracticeEvidence,approved=false):PracticeEvidence{
 const fresh=evaluateStrategy(s,m,e);
 if(result.strategyVersion!==s.version||result.mandateVersion!==m.version||result.symbol!==s.symbol||result.amountCents!==fresh.amountCents||result.side!==fresh.side||result.observedAt!==e.now||JSON.stringify(result.evidence)!==JSON.stringify(e)||fresh.status==='held'||fresh.status==='awaiting_approval'&&!approved)throw Error('Practice proposal changed, blocked or requires approval. Recheck first.');
 const priceCents=e.pricesCents[s.symbol];
 if(result.side==='sell'){
  const {nextUnits,proceedsCents}=salePosition(e,s.symbol,priceCents,result.amountCents);
  if(proceedsCents!==result.amountCents||proceedsCents<1)throw Error('Practice sale value changed. Recheck first.');
  return {...e,cashCents:e.cashCents+proceedsCents,shareUnitsNanos:{...e.shareUnitsNanos,[s.symbol]:nextUnits.toString()},holdingsCents:{...e.holdingsCents,[s.symbol]:valueForUnits(nextUnits,priceCents)},lastFillAt:e.now};
 }
 const {units,estimated}=existingUnits(e,s.symbol,priceCents);const nextUnits=units+unitsForValue(result.amountCents,priceCents);
 return {...e,cashCents:e.cashCents-result.amountCents,shareUnitsNanos:{...e.shareUnitsNanos,[s.symbol]:nextUnits.toString()},valuationEstimated:estimated,holdingsCents:{...e.holdingsCents,[s.symbol]:valueForUnits(nextUnits,priceCents)},spentDay:utcDay(e.now),spentCents:(e.spentDay===utcDay(e.now)?e.spentCents:0)+result.amountCents,lastFillAt:e.now};
}
