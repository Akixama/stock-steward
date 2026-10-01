import type {Mandate} from './decision.ts';
export type PortfolioTarget={symbol:string;targetBps:number};
export type Strategy={version:number;kind:'scheduled'|'threshold'|'allocation'|'accumulate'|'sell_threshold'|'sell_below'|'price_band'|'rebalance'|'portfolio';direction:string;symbol:string;amountCents:number;reserveCents:number;intervalHours:number;thresholdCents:number;sellThresholdCents?:number;targetBps:number;driftBps:number;maxMovementBps:number;mode:'approval'|'automatic';targets?:PortfolioTarget[]};
export type PracticeEvidence={now:number;quoteAt:number;quoteAtBySymbol?:Record<string,number>;cashCents:number;holdingsCents:Record<string,number>;pricesCents:Record<string,number>;askPricesCents?:Record<string,number>;previousPricesCents:Record<string,number>;spentDay:string;spentCents:number;lastFillAt:number|null;grant:boolean;shareUnitsNanos?:Record<string,string>;valuationEstimated?:boolean};
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
 if(!s||!['scheduled','threshold','allocation','accumulate','sell_threshold','sell_below','price_band','rebalance','portfolio'].includes(s.kind)||!['approval','automatic'].includes(s.mode)||!Number.isSafeInteger(s.version)||s.version<1||!/^([A-Z][A-Z0-9.]{0,7})$/.test(s.symbol)||typeof s.direction!=='string'||s.direction.length>1500)throw Error('Choose a supported strategy and a valid symbol.');
 for(const v of [s.amountCents,s.reserveCents,s.intervalHours,s.thresholdCents,s.targetBps,s.driftBps,s.maxMovementBps])if(!Number.isSafeInteger(v)||v<0)throw Error('Use finite, nonnegative values with at most two decimal places.');
 if(s.amountCents<1||s.amountCents>100000000||s.reserveCents>100000000||s.intervalHours<1||s.intervalHours>8760||s.thresholdCents<1||s.thresholdCents>100000000||s.targetBps<1||s.targetBps>10000||s.driftBps>10000||s.maxMovementBps>10000)throw Error('Strategy values are outside the supported ranges.');
 if(s.sellThresholdCents!==undefined&&(!Number.isSafeInteger(s.sellThresholdCents)||s.sellThresholdCents<1||s.sellThresholdCents>100000000))throw Error('Use a valid sell price.');
 if(s.kind==='price_band'&&(!s.sellThresholdCents||s.sellThresholdCents<=s.thresholdCents))throw Error('Set the sell price above the buy price.');
 if(['allocation','rebalance'].includes(s.kind)&&s.driftBps>=s.targetBps)throw Error('The allocation drift band must be smaller than the target.');
 if(s.kind==='rebalance'&&s.targetBps+s.driftBps>10000)throw Error('The upper rebalancing band cannot exceed 100%.');
 if(s.kind==='portfolio'){
  if(!Array.isArray(s.targets)||s.targets.length<2||s.targets.length>3)throw Error('Choose two or three portfolio targets.');
  const symbols=new Set<string>();let total=0;
  for(const target of s.targets){if(!target||!/^([A-Z][A-Z0-9.]{0,7})$/.test(target.symbol)||!Number.isSafeInteger(target.targetBps)||target.targetBps<0||target.targetBps>10000||symbols.has(target.symbol))throw Error('Use distinct approved stocks and valid target percentages.');symbols.add(target.symbol);total+=target.targetBps;}
  if(total>10000||total===0||s.driftBps<1||s.driftBps>2500)throw Error('Portfolio targets must total 1–100%, with a drift band of 0.01–25 percentage points.');
 }
 return s;
}
function portfolioTrade(s:Strategy,e:PracticeEvidence,total:number){
 const candidates=(s.targets??[]).map(target=>{
  const position=e.holdingsCents[target.symbol]??0;
  const targetCents=Number((BigInt(total)*BigInt(target.targetBps)+5000n)/10000n);
  const lower=BigInt(position)*10000n<BigInt(total)*BigInt(Math.max(0,target.targetBps-s.driftBps));
  const upper=BigInt(position)*10000n>BigInt(total)*BigInt(target.targetBps+s.driftBps);
  const side:StrategyResult['side']=upper?'sell':'buy';
  return {symbol:target.symbol,side,amountCents:Math.min(s.amountCents,Math.abs(position-targetCents)),deviation:Math.abs(position-targetCents),eligible:upper||lower};
 }).filter(candidate=>candidate.eligible&&candidate.amountCents>0);
 // Reduce overweight holdings before using cash for underweight ones. One trade is proposed per check.
 candidates.sort((a,b)=>Number(b.side==='sell')-Number(a.side==='sell')||b.deviation-a.deviation||a.symbol.localeCompare(b.symbol));
 return candidates[0]??{symbol:s.targets![0].symbol,side:'buy' as const,amountCents:0,deviation:0,eligible:false};
}
export function evaluateStrategy(s:Strategy,m:Mandate,e:PracticeEvidence):StrategyResult{
 validateStrategy(s);const numbers=[e.now,e.quoteAt,e.cashCents,e.spentCents,...Object.values(e.holdingsCents),...Object.values(e.pricesCents),...Object.values(e.previousPricesCents)];
 if(numbers.some(v=>!Number.isSafeInteger(v)||v<0)||e.lastFillAt!==null&&(!Number.isSafeInteger(e.lastFillAt)||e.lastFillAt>e.now)||!Number.isSafeInteger(m.version)||m.version<1||[m.maxOrderCents,m.maxDailyBuyCents,m.maxPositionBps].some(v=>!Number.isSafeInteger(v)||v<1)||m.maxPositionBps>10000)throw Error('Complete practice evidence and saved limits are required.');
 const total=e.cashCents+Object.values(e.holdingsCents).reduce((a,b)=>a+b,0);
 if(!Number.isSafeInteger(total))throw Error('Practice value exceeds supported precision.');
 const portfolio=s.kind==='portfolio'?portfolioTrade(s,e,total):null;
 const symbol=portfolio?.symbol??s.symbol,position=e.holdingsCents[symbol]??0,price=e.pricesCents[symbol]??0,ask=e.askPricesCents?.[symbol]??price,previous=e.previousPricesCents[symbol]??0;
 const elapsed=e.lastFillAt===null||e.now-e.lastFillAt>=s.intervalHours*3600000;
 const belowTarget=total>0&&BigInt(position)*10000n<BigInt(total)*BigInt(s.targetBps-s.driftBps);
 const aboveTarget=total>0&&BigInt(position)*10000n>BigInt(total)*BigInt(s.targetBps+s.driftBps);
 const movementOkay=previous>0&&BigInt(Math.abs(ask-previous))*10000n<=BigInt(previous)*BigInt(s.maxMovementBps);
 const side:StrategyResult['side']=portfolio?.side??(s.kind==='sell_threshold'||s.kind==='sell_below'||s.kind==='price_band'&&price>=s.sellThresholdCents!||s.kind==='rebalance'&&aboveTarget?'sell':'buy');
 const targetCents=Number((BigInt(total)*BigInt(s.targetBps)+5000n)/10000n);
 const amountCents=portfolio?.amountCents??(s.kind==='rebalance'?Math.min(s.amountCents,Math.abs(position-targetCents)):s.amountCents);
 const trigger=s.kind==='scheduled'?elapsed:s.kind==='threshold'?ask>0&&ask<=s.thresholdCents:s.kind==='allocation'?belowTarget:s.kind==='accumulate'?elapsed&&movementOkay:s.kind==='sell_threshold'?elapsed&&price>=s.thresholdCents:s.kind==='sell_below'?elapsed&&price>0&&price<=s.thresholdCents:s.kind==='price_band'?elapsed&&(ask>0&&ask<=s.thresholdCents||price>=s.sellThresholdCents!):s.kind==='portfolio'?elapsed&&portfolio!.eligible:elapsed&&(belowTarget||aboveTarget);
 const intervalLabel=`${s.intervalHours} ${s.intervalHours===1?'hour':'hours'}`;
 const timeSinceTrade=e.lastFillAt===null?'No previous completed trade.':`${Math.floor((e.now-e.lastFillAt)/60000)} minutes since the last completed trade.`;
 const triggerDetail=s.kind==='scheduled'?`At least ${intervalLabel} between completed buys.`:s.kind==='threshold'?`Price must be at or below $${(s.thresholdCents/100).toFixed(2)}.`:s.kind==='allocation'?`Buy only below ${(s.targetBps-s.driftBps)/100}% allocation; no selling in this strategy.`:s.kind==='accumulate'?`Interval ${intervalLabel}; price movement at most ${s.maxMovementBps/100}%.`:s.kind==='sell_threshold'?`Observed sale price $${(price/100).toFixed(2)}; sell at or above $${(s.thresholdCents/100).toFixed(2)}. ${timeSinceTrade} At least ${intervalLabel} between trades.`:s.kind==='sell_below'?`Observed sale price $${(price/100).toFixed(2)}; sell at or below $${(s.thresholdCents/100).toFixed(2)}. ${timeSinceTrade} At least ${intervalLabel} between trades.`:s.kind==='price_band'?`Buy at or below $${(s.thresholdCents/100).toFixed(2)} or sell at or above $${(s.sellThresholdCents!/100).toFixed(2)}, at least ${intervalLabel} between trades.`:s.kind==='portfolio'?`Trade one target outside its ${s.driftBps/100}-point band, at least ${intervalLabel} after the last trade.`:`Trade only outside ${(s.targetBps-s.driftBps)/100}%–${(s.targetBps+s.driftBps)/100}%, at least ${intervalLabel} after the last trade.`;
 const checks:StrategyResult['checks']=[];const add=(name:string,passed:boolean,detail:string)=>checks.push({name,passed,detail});
 add('Practice permission',e.grant,'Practice permission is separate from any live wallet grant.');
 const needed=[...new Set([...(s.kind==='portfolio'?s.targets!.map(t=>t.symbol):[symbol]),...Object.entries(e.holdingsCents).filter(([,value])=>value>0).map(([held])=>held)])];
 add('Fresh price evidence',needed.every(item=>{const at=e.quoteAtBySymbol?.[item]??e.quoteAt;return at<=e.now+10000&&e.now-at<=60000&&(e.pricesCents[item]??0)>0&&(e.askPricesCents?.[item]??e.pricesCents[item])>0;}),'Every target price must be no more than 60 seconds old.');
 add('Strategy trigger',trigger,triggerDetail);
 add('Allowed stock',needed.every(item=>m.allowedSymbols.includes(item)),`${needed.join(', ')}; allowed: ${m.allowedSymbols.join(', ')||'none'}.`);
 add('Order size',amountCents>0&&amountCents<=m.maxOrderCents,`Each practice trade must fit the $${(m.maxOrderCents/100).toFixed(2)} order cap.`);
 if(side==='buy'){
  const today=e.spentDay===utcDay(e.now)?e.spentCents:0;
  add('Daily buy budget',BigInt(today)+BigInt(amountCents)<=BigInt(m.maxDailyBuyCents),`Spent $${(today/100).toFixed(2)} of $${(m.maxDailyBuyCents/100).toFixed(2)} today.`);
  add('Cash reserve',e.cashCents-amountCents>=s.reserveCents,`Keep at least $${(s.reserveCents/100).toFixed(2)} after buying.`);
  add('Concentration',total>0&&(BigInt(position)+BigInt(amountCents))*10000n<=BigInt(total)*BigInt(m.maxPositionBps),`Maximum ${m.maxPositionBps/100}% of the simulated portfolio.`);
  if(s.kind==='allocation'||s.kind==='rebalance'||s.kind==='portfolio'){const target=s.kind==='portfolio'?s.targets!.find(t=>t.symbol===symbol)!.targetBps:s.targetBps;add('Target ceiling',total>0&&(BigInt(position)+BigInt(amountCents))*10000n<=BigInt(total)*BigInt(target),'The practice buy must not overshoot the target.');}
 }else{
  add('Held shares',position>=amountCents&&amountCents>0,`At least $${(amountCents/100).toFixed(2)} of ${s.symbol} must be held before selling.`);
  add('Precise position',e.valuationEstimated!==true&&typeof e.shareUnitsNanos?.[symbol]==='string','Selling needs share quantities from a fresh practice run; older estimated holdings must be reset.');
 }
 const failure=checks.find(c=>!c.passed);
 return {status:failure?'held':s.mode==='approval'?'awaiting_approval':'ready',why:failure?failure.name+': '+failure.detail:s.mode==='approval'?`All checks passed. Exact practice ${side} awaits your approval.`:'All checks passed within the active practice permission.',checks,symbol,amountCents,side,strategyVersion:s.version,mandateVersion:m.version,observedAt:e.now,mode:'practice',evidence:structuredClone(e)};
}
export function practiceFill(result:StrategyResult,s:Strategy,m:Mandate,e:PracticeEvidence,approved=false):PracticeEvidence{
 const fresh=evaluateStrategy(s,m,e);
 if(result.strategyVersion!==s.version||result.mandateVersion!==m.version||result.symbol!==fresh.symbol||result.amountCents!==fresh.amountCents||result.side!==fresh.side||result.observedAt!==e.now||JSON.stringify(result.evidence)!==JSON.stringify(e)||fresh.status==='held'||fresh.status==='awaiting_approval'&&!approved)throw Error('Practice proposal changed, blocked or requires approval. Recheck first.');
 const symbol=result.symbol,priceCents=e.pricesCents[symbol];
 if(result.side==='sell'){
  const {nextUnits,proceedsCents}=salePosition(e,symbol,priceCents,result.amountCents);
  if(proceedsCents!==result.amountCents||proceedsCents<1)throw Error('Practice sale value changed. Recheck first.');
  return {...e,cashCents:e.cashCents+proceedsCents,shareUnitsNanos:{...e.shareUnitsNanos,[symbol]:nextUnits.toString()},holdingsCents:{...e.holdingsCents,[symbol]:valueForUnits(nextUnits,priceCents)},lastFillAt:e.now};
 }
 const {units,estimated}=existingUnits(e,symbol,priceCents);const nextUnits=units+unitsForValue(result.amountCents,e.askPricesCents?.[symbol]??priceCents);
 return {...e,cashCents:e.cashCents-result.amountCents,shareUnitsNanos:{...e.shareUnitsNanos,[symbol]:nextUnits.toString()},valuationEstimated:estimated,holdingsCents:{...e.holdingsCents,[symbol]:valueForUnits(nextUnits,priceCents)},spentDay:utcDay(e.now),spentCents:(e.spentDay===utcDay(e.now)?e.spentCents:0)+result.amountCents,lastFillAt:e.now};
}
