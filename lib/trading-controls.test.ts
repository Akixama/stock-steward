import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTradingEnabled,tradingAdmission,tradingLimits} from './trading-controls.ts';

const owner='0x'+'a'.repeat(40);
test('public mode defaults off and admits only the verified pilot wallet',()=>{
 assert.deepEqual(tradingLimits({}),{publicMode:false,maxOrderCents:1000,maxDailyCents:5000});
 assert.equal(tradingAdmission(owner,{}).ok,false);
 assert.equal(tradingAdmission(owner,{STEWARD_LIVE_BUY_PILOT_WALLETS:owner}).ok,true);
 assert.equal(tradingAdmission(undefined,{PUBLIC_MODE:'true'}).ok,false);
 assert.equal(tradingAdmission(owner,{PUBLIC_MODE:'true'}).ok,true);
 assert.equal(tradingAdmission(owner,{PUBLIC_MODE:'TRUE'}).ok,false);
});
test('public caps are low by default and malformed configuration fails closed',()=>{
 assert.deepEqual(tradingLimits({PUBLIC_MODE:'true'}),{publicMode:true,maxOrderCents:500,maxDailyCents:2000});
 assert.deepEqual(tradingLimits({PUBLIC_MODE:'true',STEWARD_PUBLIC_MAX_ORDER_CENTS:'800',STEWARD_PUBLIC_MAX_DAILY_CENTS:'900'}),{publicMode:true,maxOrderCents:800,maxDailyCents:900});
 for(const value of ['0','-1','1.5','wat','1000001'])assert.throws(()=>tradingLimits({PUBLIC_MODE:'true',STEWARD_PUBLIC_MAX_ORDER_CENTS:value}));
 assert.throws(()=>tradingLimits({PUBLIC_MODE:'true',STEWARD_PUBLIC_MAX_ORDER_CENTS:'600',STEWARD_PUBLIC_MAX_DAILY_CENTS:'500'}));
});
test('runtime and D1 kill switches fail closed',async()=>{
 const db={prepare(){return {first:async()=>({disabled:0})}}} as unknown as D1Database;
 await assertTradingEnabled(db,{});
 await assert.rejects(()=>assertTradingEnabled(db,{STEWARD_TRADING_KILL_SWITCH:'true'}));
 await assert.rejects(()=>assertTradingEnabled({prepare(){return {first:async()=>({disabled:1})}}} as unknown as D1Database,{}));
 await assert.rejects(()=>assertTradingEnabled({prepare(){return {first:async()=>null}}} as unknown as D1Database,{}));
});
