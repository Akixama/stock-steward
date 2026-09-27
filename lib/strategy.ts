import type {Mandate} from './decision.ts';
export type Strategy={version:number;kind:'scheduled'|'threshold'|'allocation'|'accumulate';direction:string;symbol:string;amountCents:number;reserveCents:number;intervalHours:number;thresholdCents:number;targetBps:number;driftBps:number;maxMovementBps:number;mode:'approval'|'automatic'};
export type PracticeEvidence={now:number;quoteAt:number;cashCents:number;holdingsCents:Record<string,number>;pricesCents:Record<string,number>;previousPricesCents:Record<string,number>;spentDay:string;spentCents:number;lastFillAt:number|null;grant:boolean};
export type StrategyResult={status:'held'|'awaiting_approval'|'ready';why:string;checks:{name:string;passed:boolean;detail:string}[];symbol:string;amountCents:number;strategyVersion:number;mandateVersion:number;observedAt:number;mode:'practice';evidence:PracticeEvidence};
export const utcDay=(now:number)=>new Date(now).toISOString().slice(0,10);
export function validateStrategy(s:Strategy){
 if(!s||!['scheduled','threshold','allocation','accumulate'].includes(s.kind)||!['approval','automatic'].includes(s.mode)||!Number.isSafeInteger(s.version)||s.version<1||!/^([A-Z][A-Z0-9.]{0,7})$/.test(s.symbol)||typeof s.direction!=='string'||s.direction.length>1500)throw Error('Choose a supported strategy and a valid symbol.');
 for(const v of [s.amountCents,s.reserveCents,s.intervalHours,s.thresholdCents,s.targetBps,s.driftBps,s.maxMovementBps])if(!Number.isSafeInteger(v)||v<0)throw Error('Use finite, nonnegative values with at most two decimal places.');
 if(s.amountCents<1||s.amountCents>100000000||s.reserveCents>100000000||s.intervalHours<1||s.intervalHours>8760||s.thresholdCents<1||s.thresholdCents>100000000||s.targetBps<1||s.targetBps>10000||s.driftBps>10000||s.maxMovementBps>10000)throw Error('Strategy values are outside the supported ranges.');
 if(s.kind==='allocation'&&s.driftBps>=s.targetBps)throw Error('The allocation drift band must be smaller than the target.');
 return s;
}
export function evaluateStrategy(s:Strategy,m:Mandate,e:PracticeEvidence):StrategyResult{
 validateStrategy(s);const numbers=[e.now,e.quoteAt,e.cashCents,e.spentCents,...Object.values(e.holdingsCents),...Object.values(e.pricesCents),...Object.values(e.previousPricesCents)];
 if(numbers.some(v=>!Number.isSafeInteger(v)||v<0)||e.lastFillAt!==null&&(!Number.isSafeInteger(e.lastFillAt)||e.lastFillAt>e.now)||!Number.isSafeInteger(m.version)||m.version<1||[m.maxOrderCents,m.maxDailyBuyCents,m.maxPositionBps].some(v=>!Number.isSafeInteger(v)||v<1)||m.maxPositionBps>10000)throw Error('Complete practice evidence and saved limits are required.');
 const total=e.cashCents+Object.values(e.holdingsCents).reduce((a,b)=>a+b,0),position=e.holdingsCents[s.symbol]??0,price=e.pricesCents[s.symbol]??0,previous=e.previousPricesCents[s.symbol]??0;
 if(!Number.isSafeInteger(total))throw Error('Practice value exceeds supported precision.');
 const elapsed=e.lastFillAt===null||e.now-e.lastFillAt>=s.intervalHours*3600000;
 const belowTarget=total>0&&BigInt(position)*10000n<BigInt(total)*BigInt(Math.max(0,s.targetBps-s.driftBps));
 const movementOkay=previous>0&&BigInt(Math.abs(price-previous))*10000n<=BigInt(previous)*BigInt(s.maxMovementBps);
 const trigger=s.kind==='scheduled'?elapsed:s.kind==='threshold'?price>0&&price<=s.thresholdCents:s.kind==='allocation'?belowTarget:elapsed&&movementOkay;
 const checks:StrategyResult['checks']=[];const add=(name:string,passed:boolean,detail:string)=>checks.push({name,passed,detail});
 add('Practice permission',e.grant,'Practice permission is separate from any live wallet grant.');
 add('Fresh simulated evidence',e.quoteAt<=e.now&&e.now-e.quoteAt<=60000&&price>0,'Simulated quote must be no more than 60 seconds old.');
 add('Strategy trigger',trigger,s.kind==='scheduled'?`At least ${s.intervalHours} hours between completed buys.`:s.kind==='threshold'?`Price must be at or below $${(s.thresholdCents/100).toFixed(2)}.`:s.kind==='allocation'?`Buy only below ${(s.targetBps-s.driftBps)/100}% allocation; no selling is supported.`:`Interval ${s.intervalHours} hours; price movement at most ${s.maxMovementBps/100}%.`);
 add('Allowed stock',m.allowedSymbols.includes(s.symbol),`${s.symbol}; allowed: ${m.allowedSymbols.join(', ')||'none'}.`);
 add('Purchase size',s.amountCents<=m.maxOrderCents,'Strategy purchase must fit the saved purchase cap.');
 const today=e.spentDay===utcDay(e.now)?e.spentCents:0;
 add('Daily budget',today+s.amountCents<=m.maxDailyBuyCents,`Spent $${(today/100).toFixed(2)} of $${(m.maxDailyBuyCents/100).toFixed(2)} today.`);
 add('Cash reserve',e.cashCents-s.amountCents>=s.reserveCents,`Keep at least $${(s.reserveCents/100).toFixed(2)} after buying.`);
 add('Concentration',total>0&&BigInt(position+s.amountCents)*10000n<=BigInt(total)*BigInt(m.maxPositionBps),`Maximum ${m.maxPositionBps/100}% of the simulated portfolio.`);
 if(s.kind==='allocation')add('Target ceiling',total>0&&BigInt(position+s.amountCents)*10000n<=BigInt(total)*BigInt(s.targetBps),'Fixed purchase must not overshoot the target.');
 const failure=checks.find(c=>!c.passed);
 return {status:failure?'held':s.mode==='approval'?'awaiting_approval':'ready',why:failure?failure.name+': '+failure.detail:s.mode==='approval'?'All checks passed. Exact purchase awaits your approval.':'All checks passed within the active practice permission.',checks,symbol:s.symbol,amountCents:s.amountCents,strategyVersion:s.version,mandateVersion:m.version,observedAt:e.now,mode:'practice',evidence:structuredClone(e)};
}
export function practiceFill(result:StrategyResult,s:Strategy,m:Mandate,e:PracticeEvidence,approved=false):PracticeEvidence{
 const fresh=evaluateStrategy(s,m,e);
 if(result.strategyVersion!==s.version||result.mandateVersion!==m.version||result.symbol!==s.symbol||result.amountCents!==s.amountCents||result.observedAt!==e.now||JSON.stringify(result.evidence)!==JSON.stringify(e)||fresh.status==='held'||fresh.status==='awaiting_approval'&&!approved)throw Error('Practice proposal changed, blocked or requires approval. Recheck first.');
 return {...e,cashCents:e.cashCents-s.amountCents,holdingsCents:{...e.holdingsCents,[s.symbol]:(e.holdingsCents[s.symbol]??0)+s.amountCents},spentDay:utcDay(e.now),spentCents:(e.spentDay===utcDay(e.now)?e.spentCents:0)+s.amountCents,lastFillAt:e.now};
}
