import type {RouteEvidence} from './chain-route.ts';
import {routerCandidate,validateRouterCandidate} from './router-candidate.ts';
import type {AttemptPlan} from '../db/execution-attempts.ts';
export type SpendRow={intent_id:string;amount_cents:number;state:string;execution_day:string;plan_json:string|null};
export type SettlementReview={observedAt:string;blockHash:string;balanceRaw:string;decimals:number;reservedRaw:string|null;unreservedRaw:string|null;pendingCount:number;knownDailyFilledCents:string|null;knownPendingCents:string|null;externalActivityReconciled:false;fullPortfolioVerified:false;usdPriceVerified:false;executionEnabled:false;checks:{name:string;state:'pass'|'fail'|'pending';reason:string}[]};
// Server-generated route + authenticated owner's ledger only. A zero local ledger is not zero external spend.
export function reviewSettlement(route:RouteEvidence,rows:SpendRow[],now=Date.now()):SettlementReview{
 const review:SettlementReview={observedAt:new Date(now).toISOString(),blockHash:route.blockHash,balanceRaw:route.balanceRaw,decimals:route.settlementDecimals,reservedRaw:null,unreservedRaw:null,pendingCount:0,knownDailyFilledCents:null,knownPendingCents:null,externalActivityReconciled:false,fullPortfolioVerified:false,usdPriceVerified:false,executionEnabled:false,checks:[]};
 const fresh=Number.isFinite(Date.parse(route.expiresAt))&&now<Date.parse(route.expiresAt)&&Date.parse(route.observedAt)<=now&&now-Date.parse(route.observedAt)<=30000;
 let reserved=0n,pending=0n,filled=0n,complete=true;
 try{if(rows.length>500||!/^\d{1,78}$/.test(route.balanceRaw))throw Error('Incomplete ledger');
 for(const row of rows){if(!Number.isSafeInteger(row.amount_cents)||row.amount_cents<=0)throw Error('Invalid spend');if(row.state==='confirmed'&&row.execution_day===new Date(now).toISOString().slice(0,10))filled+=BigInt(row.amount_cents);
 if(!['reserved','submitted','unknown'].includes(row.state))continue;
 review.pendingCount++;pending+=BigInt(row.amount_cents);
 try{const plan=JSON.parse(row.plan_json??'null') as AttemptPlan;if(!plan?.route||plan.address!==route.address||plan.intentDigest!==row.intent_id||plan.route.settlement!==route.settlement||!validateRouterCandidate(plan.route,plan.mandateVersion,plan.candidate)||routerCandidate(plan.route,plan.mandateVersion).intentDigest!==row.intent_id)throw Error('Raw reservation unavailable');reserved+=BigInt(plan.route.inputRaw);}catch{complete=false;}
 }
 review.knownDailyFilledCents=filled.toString();review.knownPendingCents=pending.toString();
 if(complete){review.reservedRaw=reserved.toString();const free=BigInt(route.balanceRaw)-reserved;review.unreservedRaw=(free>0n?free:0n).toString();review.checks.push({name:'Recorded unreserved settlement',state:!fresh?'pending':free>=BigInt(route.inputRaw)?'pass':'fail',reason:'Observed USDG balance minus unresolved Steward raw reservations. This does not establish external spending, USD value or wallet authority.'});}
 else review.checks.push({name:'Recorded unreserved settlement',state:'pending',reason:'At least one unresolved reservation lacks a validated raw input. It remains reserved; no free balance is inferred.'});
 }catch{review.reservedRaw=null;review.unreservedRaw=null;review.checks.push({name:'Recorded unreserved settlement',state:'pending',reason:'Ledger evidence is incomplete or invalid. No unreserved-funds conclusion was made.'});}
 review.checks.push({name:'Verified USD prices',state:'pending',reason:'USDG is not assumed to equal one dollar. A verified current USD price bound is required to apply dollar purchase limits.'},{name:'External activity and daily totals',state:'pending',reason:'Local filled and pending values cover Steward records only. External buys and pending operations have not been reconciled.'},{name:'Complete portfolio concentration',state:'pending',reason:'The stock-token subtotal excludes other assets and liabilities. It cannot establish the complete portfolio denominator.'});
 return review;
}
