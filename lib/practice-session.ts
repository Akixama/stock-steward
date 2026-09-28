import {evaluateStrategy,practiceFill,validateStrategy,utcDay,type Strategy,type PracticeEvidence,type StrategyResult} from './strategy.ts';
import type {Mandate} from './decision.ts';
export type PracticeReceipt=StrategyResult&{id:string;outcome:'held'|'awaiting_approval'|'simulated_fill'|'declined';createdAt:string;approvalExpiresAt:number;trigger:'manual'|'foreground'|'background'};
export type PracticeSession={schema:'stock-steward-practice-v2';revision:number;strategy:Strategy|null;account:PracticeEvidence;receipts:PracticeReceipt[];running:boolean;background:boolean;mandateVersion:number;permissionExpiresAt:number|null;lastWallAt:number;lastCheckWallAt:number;nextDueAt:number;feedAvailable:boolean};
export type PracticeAction={action:'confirm';strategy:Strategy}|{action:'price';symbol:string;priceCents:number}|{action:'approve'|'decline';id:string}|{action:'scenario';scenario:'healthy'|'stale'|'cash'|'daily'|'concentration'}|{action:'background';enabled:boolean}|{action:'authorize'|'start'|'pause'|'revoke'|'run'|'advance'|'refresh_quote'|'refresh'|'reset'};
export function newPracticeSession(now=Date.now()):PracticeSession{return {schema:'stock-steward-practice-v2',revision:0,strategy:null,account:{now,quoteAt:now,cashCents:100000,holdingsCents:{},pricesCents:{AAPL:18000,META:50000,MSFT:42000},previousPricesCents:{AAPL:18000,META:50000,MSFT:42000},spentDay:utcDay(now),spentCents:0,lastFillAt:null,grant:false},receipts:[],running:false,background:false,mandateVersion:0,permissionExpiresAt:null,lastWallAt:now,lastCheckWallAt:0,nextDueAt:now,feedAvailable:true};}
function stop(s:PracticeSession,why:string){s.running=false;s.background=false;s.account.grant=false;s.permissionExpiresAt=null;for(const r of s.receipts)if(r.outcome==='awaiting_approval'){r.outcome='declined';r.why=why;}}
function cancelPending(s:PracticeSession,why:string){for(const r of s.receipts)if(r.outcome==='awaiting_approval'){r.outcome='held';r.why=why;}}
export function transitionPractice(previous:PracticeSession,m:Mandate,action:PracticeAction,now=Date.now(),trigger:PracticeReceipt['trigger']='manual'){
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid practice clock.');
 const s=structuredClone(previous);if(s.schema!=='stock-steward-practice-v2')throw Error('Unsupported practice session.');
 if(s.mandateVersion!==m.version){stop(s,'Saved boundaries changed. Review and authorize practice again.');s.mandateVersion=m.version;}
 if(s.permissionExpiresAt!==null&&now>=s.permissionExpiresAt)stop(s,'Practice permission expired. Authorize it again before running.');
 for(const r of s.receipts)if(r.outcome==='awaiting_approval'&&now>=r.approvalExpiresAt){r.outcome='held';r.why='Approval expired. Run a new check; no purchase was made.';}
 switch(action.action){
 case 'refresh':break;
 case 'confirm':s.strategy=validateStrategy({...action.strategy,version:(s.strategy?.version??0)+1});stop(s,'Strategy replaced; old approval is no longer valid.');break;
 case 'authorize':if(!s.strategy||m.version<1)throw Error('Confirm a strategy and save boundaries first.');s.account.grant=true;s.permissionExpiresAt=now+86400000;break;
 case 'start':if(!s.account.grant||!s.strategy)throw Error('Authorize practice first.');s.running=true;s.nextDueAt=now;break;
 case 'pause':s.running=false;s.background=false;break;
 case 'revoke':stop(s,'Practice permission revoked. No purchase was made.');break;
 case 'background':if(action.enabled&&(!s.running||!s.account.grant))throw Error('Start the authorized practice agent first.');s.background=action.enabled;s.nextDueAt=now;break;
 case 'advance':cancelPending(s,'Test clock changed. Run a new check before approval.');s.account.now+=86400000;s.account.quoteAt=s.account.now;s.lastWallAt=now;break;
 case 'refresh_quote':s.feedAvailable=true;cancelPending(s,'Quote refreshed. Run a new check before approval.');s.account.quoteAt=s.account.now;break;
 case 'price':{if(!/^[A-Z][A-Z0-9.]{0,7}$/.test(action.symbol)||!Number.isSafeInteger(action.priceCents)||action.priceCents<1||action.priceCents>100000000)throw Error('Invalid simulated price.');cancelPending(s,'Simulated price changed. Run a new check before approval.');const before=s.account.pricesCents[action.symbol]??action.priceCents;s.account.previousPricesCents[action.symbol]=before;s.account.pricesCents[action.symbol]=action.priceCents;s.account.holdingsCents[action.symbol]=Number(BigInt(s.account.holdingsCents[action.symbol]??0)*BigInt(action.priceCents)/BigInt(before));s.account.quoteAt=s.account.now;break;}
 case 'scenario':{s.running=false;s.background=false;cancelPending(s,'Test scenario changed. Run a new check.');const symbol=s.strategy?.symbol??'AAPL';s.feedAvailable=action.scenario!=='stale';s.account.cashCents=action.scenario==='cash'?0:100000;s.account.holdingsCents=action.scenario==='concentration'?{[symbol]:1000000}:{};s.account.spentDay=utcDay(s.account.now);s.account.spentCents=action.scenario==='daily'?m.maxDailyBuyCents:0;s.account.lastFillAt=null;s.account.quoteAt=action.scenario==='stale'?s.account.now-120000:s.account.now;break;}
 case 'reset':{if(s.running||s.background||s.account.grant)throw Error('Revoke practice permission before resetting.');const fresh=newPracticeSession(now);fresh.strategy=s.strategy;fresh.mandateVersion=m.version;fresh.revision=s.revision;return fresh;}
 case 'decline':{const r=s.receipts.find(r=>r.id===action.id&&r.outcome==='awaiting_approval');if(!r)throw Error('This purchase is no longer awaiting approval.');r.outcome='declined';r.why='You declined the practice purchase.';break;}
 case 'approve':{const r=s.receipts.find(r=>r.id===action.id&&r.outcome==='awaiting_approval');if(!r||!s.strategy)throw Error('Approval expired or changed. Run a new check.');s.account=practiceFill(r,s.strategy,m,s.account,true);s.lastWallAt=now;r.outcome='simulated_fill';r.why='Exact practice purchase approved. Simulated cash and holdings updated.';break;}
 case 'run':{if(!s.strategy)throw Error('Confirm a strategy first.');if(s.receipts.some(r=>r.outcome==='awaiting_approval'))break;if(now-s.lastCheckWallAt<8000)break;
 s.account.now+=Math.max(0,now-s.lastWallAt);s.lastWallAt=now;s.lastCheckWallAt=now;if(s.feedAvailable)s.account.quoteAt=s.account.now;
 const result=evaluateStrategy(s.strategy,m,s.account);const outcome=result.status==='held'?'held':result.status==='ready'?'simulated_fill':'awaiting_approval';if(result.status==='ready')s.account=practiceFill(result,s.strategy,m,s.account);
 s.receipts.unshift({...result,id:crypto.randomUUID(),outcome,createdAt:new Date(result.observedAt).toISOString(),approvalExpiresAt:now+60000,trigger});s.receipts=s.receipts.slice(0,50);s.nextDueAt=now+900000;break;}
 }
 return s;
}
