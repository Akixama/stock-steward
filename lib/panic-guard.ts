// Panic guard: automatic trading stops itself when the account falls too far,
// then waits out a cool-off before it can be resumed. It protects against the
// strategy and against the owner rage-restarting it.
export type GuardSettings={dropBps:number;lossCents:number|null;cooloffHours:number};
export type GuardState={grantId:string;peakMicro:string|null;startMicro:string|null;trippedAt:string|null;resumeAfter:string|null;reason:string|null};
export const GUARD_DROP_OPTIONS=[500,1000,1500,2000] as const;      // 5%..20%
export const GUARD_COOLOFF_OPTIONS=[6,24,72] as const;              // hours
export const DEFAULT_GUARD:GuardSettings={dropBps:1000,lossCents:null,cooloffHours:24};

export function validGuardSettings(value:unknown):GuardSettings{
 const v=value as Partial<GuardSettings>;
 if(!v||!(GUARD_DROP_OPTIONS as readonly number[]).includes(v.dropBps as number))throw Error('Choose a 5, 10, 15 or 20% drop.');
 if(!(GUARD_COOLOFF_OPTIONS as readonly number[]).includes(v.cooloffHours as number))throw Error('Choose a 6, 24 or 72 hour cool-off.');
 if(v.lossCents!==null&&v.lossCents!==undefined&&(!Number.isSafeInteger(v.lossCents)||v.lossCents<100||v.lossCents>10_000_000))throw Error('A loss limit must be $1 to $100,000.');
 return {dropBps:v.dropBps!,cooloffHours:v.cooloffHours!,lossCents:v.lossCents??null};
}

export const coolingUntil=(state:GuardState|null,now:number)=>state?.resumeAfter&&Date.parse(state.resumeAfter)>now?state.resumeAfter:null;

// valueMicro: the account's conservative value (lower price bounds) right now.
export function evaluateGuard(settings:GuardSettings,state:GuardState,valueMicro:bigint,now:Date):{state:GuardState;tripped:boolean;why:string|null}{
 if(valueMicro<0n)throw Error('Invalid account value.');
 const iso=now.toISOString();
 const start=state.startMicro?BigInt(state.startMicro):valueMicro;
 const previousPeak=state.peakMicro?BigInt(state.peakMicro):valueMicro;
 const peak=valueMicro>previousPeak?valueMicro:previousPeak;
 const next:GuardState={...state,startMicro:start.toString(),peakMicro:peak.toString()};
 if(coolingUntil(state,now.getTime()))return {state:next,tripped:false,why:null};
 const dropBps=peak>0n?Number((peak-valueMicro)*10000n/peak):0;
 const lossMicro=start>valueMicro?start-valueMicro:0n;
 let why:string|null=null;
 if(dropBps>=settings.dropBps)why=`Your account fell ${(dropBps/100).toFixed(1)}% from its high of ${dollars(peak)}.`;
 else if(settings.lossCents!==null&&lossMicro>=BigInt(settings.lossCents)*10_000n)why=`Your account is down ${dollars(lossMicro)} since automatic mode started.`;
 if(!why)return {state:next,tripped:false,why:null};
 const resumeAfter=new Date(now.getTime()+settings.cooloffHours*3_600_000).toISOString();
 return {state:{...next,trippedAt:iso,resumeAfter,reason:why},tripped:true,why:`${why} Panic guard paused automatic trading until ${resumeAfter.slice(0,16).replace('T',' ')} UTC.`};
}
export function freshGuard(grantId:string):GuardState{return {grantId,peakMicro:null,startMicro:null,trippedAt:null,resumeAfter:null,reason:null};}
function dollars(micro:bigint){return '$'+(Number(micro/10_000n)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
