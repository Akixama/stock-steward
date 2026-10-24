import {validateStrategy,type Strategy} from './strategy.ts';
import {keccak256, toHex, type Hex} from 'viem';
import type {Mandate} from './decision.ts';
import type {AutonomousRunExecution} from './autonomous-run-status.ts';

// v2 release: automatic session buying is compiled on. It still needs the AUTO_BUY
// release flag, an owner-signed session permission, fee limit and Start, the
// $1/$2 caps and the kill switch before any key is loaded.
export const AUTONOMOUS_RELEASE_ENABLED = true;
export type AutonomousRule = {version:number;symbol:string;amountCents:number;kind:Strategy['kind'];strategy?:Strategy;intervalMinutes:number;thresholdCents:number};
export type AutonomousSignal = {chainId:number;symbol:string;askCents:number;observedAt:string;halted:boolean;source:string};
export type AutonomousDecision = {id:Hex;mode:'shadow';status:'blocked'|'would_trigger';symbol:string;amountCents:number;createdAt:string;checks:{name:string;passed:boolean;detail:string}[];executionEnabled:false;transactionsSent:0;execution?:AutonomousRunExecution};
export function validateAutonomousRule(rule:AutonomousRule){
 if(!rule||!Number.isSafeInteger(rule.version)||rule.version<1||!/^([A-Z][A-Z0-9.]{0,7})$/.test(rule.symbol)||(!['scheduled','threshold'].includes(rule.kind)&&!rule.strategy)||!Number.isSafeInteger(rule.amountCents)||rule.amountCents<1||rule.amountCents>1000||!Number.isSafeInteger(rule.intervalMinutes)||rule.intervalMinutes<15||rule.intervalMinutes>1440||!Number.isSafeInteger(rule.thresholdCents)||rule.thresholdCents<1||rule.thresholdCents>100000000)throw Error('Use a supported trading rule, a $0.01–$10 amount and a 15-minute to 24-hour interval.');
 if(rule.strategy){validateStrategy(rule.strategy);if(rule.strategy.mode!=='automatic'||rule.strategy.kind!==rule.kind||rule.strategy.symbol!==rule.symbol||rule.strategy.amountCents!==rule.amountCents||rule.strategy.thresholdCents!==rule.thresholdCents)throw Error('Strategy and runner controls differ.');}
 return rule;
}
export function autonomousRunId(owner:string,revision:number,slot:string){
 if(!owner||owner.length>200||!Number.isSafeInteger(revision)||revision<1||!Number.isFinite(Date.parse(slot)))throw Error('Invalid autonomous run identity.');
 return keccak256(toHex(JSON.stringify(['stock-steward-autonomous-shadow-v1',owner,revision,slot])));
}
export function evaluateAutonomousSignal(owner:string,revision:number,slot:string,rule:AutonomousRule,mandate:Mandate|null,signal:AutonomousSignal|null,now=new Date()):AutonomousDecision{
 validateAutonomousRule(rule);if(!Number.isFinite(now.getTime()))throw Error('Invalid clock.');
 const fresh=!rule.strategy&&!!signal&&signal.chainId===4663&&signal.symbol===rule.symbol&&!signal.halted&&Number.isSafeInteger(signal.askCents)&&signal.askCents>0&&Number.isFinite(Date.parse(signal.observedAt))&&now.getTime()-Date.parse(signal.observedAt)>=0&&now.getTime()-Date.parse(signal.observedAt)<=30000&&!!signal.source;
 const checks=[
  {name:'Saved mandate',passed:!!mandate&&Number.isSafeInteger(mandate.version)&&mandate.version>0,detail:'A saved mandate is required.'},
  {name:'Approved stock',passed:!!mandate?.allowedSymbols.includes(rule.symbol),detail:`Only a stock in your saved mandate may trigger.`},
  {name:'Purchase amount',passed:!!mandate&&rule.amountCents<=mandate.maxOrderCents&&rule.amountCents<=mandate.maxDailyBuyCents,detail:'The rule amount must fit both saved purchase and daily limits.'},
  {name:'Fresh market price',passed:fresh,detail:'A matching, unhalted Robinhood Chain quote no more than 30 seconds old is required.'},
  {name:'Strategy trigger',passed:fresh&&(rule.kind==='scheduled'||signal!.askCents<=rule.thresholdCents),detail:rule.kind==='scheduled'?'This scheduled check is due.':`Ask must be at or below $${(rule.thresholdCents/100).toFixed(2)}.`},
 ];
 return {id:autonomousRunId(owner,revision,slot),mode:'shadow',status:checks.every(c=>c.passed)?'would_trigger':'blocked',symbol:rule.symbol,amountCents:rule.amountCents,createdAt:now.toISOString(),checks,executionEnabled:false,transactionsSent:0};
}
