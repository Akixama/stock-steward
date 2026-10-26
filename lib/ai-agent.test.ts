import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAgentSettings,reviewAgentDecision,agentRule,priceChanges,agentInput,type AgentSettings,type AgentMarket} from './ai-agent.ts';
import {validateAutonomousRule} from './autonomous-live.ts';

const settings:AgentSettings={version:1,symbols:['NVDA','TSLA'],style:'careful',intervalMinutes:60,note:''};
const market:AgentMarket[]=[{symbol:'NVDA',bidCents:17990,askCents:18010,change1dBps:-320,change7dBps:-600,heldCents:0},{symbol:'TSLA',bidCents:24990,askCents:25010,change1dBps:900,change7dBps:1200,heldCents:5000}];
const ctx={cashCents:10000,lotCents:2500,sellable:['TSLA']};

test('settings only allow stocks in the owner Limits, 1 to 6 of them',()=>{
 assert.deepEqual(validateAgentSettings({...settings,symbols:['nvda']},['NVDA']).symbols,['NVDA']);
 assert.throws(()=>validateAgentSettings(settings,['NVDA']),/Limits/);
 assert.throws(()=>validateAgentSettings({...settings,symbols:[]},['NVDA']));
 assert.throws(()=>validateAgentSettings({...settings,intervalMinutes:5 as never},['NVDA','TSLA']));
});
test('a valid buy becomes one lot at the owner lot size and a runnable rule',()=>{
 const d=reviewAgentDecision({action:'buy',symbol:'nvda',reason:'Down 3.2% today and 6% this week.'},settings,market,ctx);
 assert.equal(d.action,'buy');assert.equal(d.symbol,'NVDA');assert.equal(d.amountCents,2500);
 const rule=agentRule(d);validateAutonomousRule(rule);assert.equal(rule.kind,'scheduled');assert.equal(rule.strategy?.mode,'automatic');
});
test('the disposer turns bad ideas into visible holds',()=>{
 assert.equal(reviewAgentDecision({action:'buy',symbol:'AAPL',reason:'x'},settings,market,ctx).blocked,'Picked a stock outside your agent list');
 assert.match(reviewAgentDecision({action:'buy',symbol:'TSLA',reason:'x'},settings,market,ctx).blocked!,/does not chase/);
 assert.equal(reviewAgentDecision({action:'buy',symbol:'TSLA',reason:'x'},{...settings,style:'bold'},market,ctx).action,'buy');
 assert.match(reviewAgentDecision({action:'buy',symbol:'NVDA',reason:'x'},settings,market,{...ctx,cashCents:100}).blocked!,/Not enough/);
 assert.match(reviewAgentDecision({action:'sell',symbol:'NVDA',reason:'x'},settings,market,ctx).blocked!,/no sale/);
 assert.equal(reviewAgentDecision({nonsense:true},settings,market,ctx).action,'hold');
});
test('a sale is capped at what is held and becomes a sell rule',()=>{
 const d=reviewAgentDecision({action:'sell',symbol:'TSLA',reason:'Up 12% this week, taking profit.'},settings,market,{...ctx,lotCents:9000});
 assert.equal(d.action,'sell');assert.equal(d.amountCents,5000);assert.equal(agentRule(d).kind,'sell_scheduled');
 assert.throws(()=>agentRule({...d,action:'hold'}));
});
test('price changes come from saved samples; the prompt input carries no addresses',()=>{
 const day=86400000,t=Date.UTC(2026,9,26);
 const c=priceChanges([{observedAt:new Date(t-7*day).toISOString(),bidCents:10000},{observedAt:new Date(t-day).toISOString(),bidCents:11000},{observedAt:new Date(t).toISOString(),bidCents:9900}]);
 assert.equal(c.change1dBps,-1000);assert.equal(c.change7dBps,-100);
 assert.doesNotMatch(agentInput(settings,market,ctx),/0x[0-9a-f]{6}/i);
});
