import test from "node:test";
import assert from "node:assert/strict";
import { readAccountView, observeClosedBuy } from "./anytime.ts";
import type { AlpacaConnection } from "./alpaca-connection.ts";
import type { Mandate } from "./decision.ts";
const connection: AlpacaConnection = { accountRef:"test-account", token:"test-token", environment:"paper", connectedAt:new Date().toISOString(), tradingScope:false };
const mandate: Mandate = { version:1, allowedSymbols:["AAPL"], maxOrderCents:1000, maxDailyBuyCents:2000, maxPositionBps:2000, requireApproval:true };
function mock(changes: { id?:string; cash?:string; timestamp?:string; open?:boolean } = {}): typeof fetch {
 return (async (input, init) => {
  assert.ok(!init?.method || init.method === "GET");
  const path=new URL(String(input)).pathname;
  const data = path === "/v2/account" ? {id:changes.id ?? "test-account",status:"ACTIVE",equity:"100",cash:changes.cash ?? "50",buying_power:"200"} : path === "/v2/positions" ? [] : path === "/v2/orders" ? [] : path === "/v2/clock" ? {is_open:changes.open ?? false,timestamp:changes.timestamp ?? new Date().toISOString(),next_open:new Date(Date.now()+86400000).toISOString()} : null;
  assert.notEqual(data,null,"no quote or trade endpoint should be called"); return Response.json(data);
 }) as typeof fetch;
}
test("closed account reads need no quote and do not count margin as cash", async()=>{
 const account=await readAccountView(connection,mock());assert.equal(account.availableCashCents,5000);assert.equal(account.marketOpen,false);
 const record=observeClosedBuy(mandate,account,{symbol:"AAPL",amountCents:100});assert.equal(record.executionReady,false);assert.equal(record.kind,"observation");
 for(const rule of ["Daily purchase limit","Position concentration","Account eligibility","Fresh quote and market session"]) assert.equal(record.checks.find(c=>c.rule===rule)?.state,"pending");
});
test("unfunded account and exceeded limits fail without becoming decisions",async()=>{
 const account=await readAccountView(connection,mock({cash:"0"}));const record=observeClosedBuy(mandate,account,{symbol:"MSFT",amountCents:2500});
 for(const rule of ["Available funds","Approved symbol","Single purchase limit","Daily purchase limit"]) assert.equal(record.checks.find(c=>c.rule===rule)?.state,"fail");assert.equal(record.executionReady,false);
});
test("mismatched account, stale clock and missing balances cannot create evidence",async()=>{
 await assert.rejects(readAccountView(connection,mock({id:"another-owner"})),/incomplete/);
 await assert.rejects(readAccountView(connection,mock({timestamp:new Date(Date.now()-120000).toISOString()})),/stale/);
 await assert.rejects(readAccountView(connection,mock({cash:" "})),/missing/);
});
test("open or stale observations cannot enter the closed-session path",async()=>{
 const account=await readAccountView(connection,mock());
 assert.throws(()=>observeClosedBuy(mandate,{...account,marketOpen:true},{symbol:"AAPL",amountCents:100}));
 assert.throws(()=>observeClosedBuy(mandate,{...account,observedAt:new Date(Date.now()-120000).toISOString()},{symbol:"AAPL",amountCents:100}));
});
