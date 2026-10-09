import test from "node:test";
import assert from "node:assert/strict";
import { decimal18, priceEvidence, enrichObservation, purchasePreview, compareObservations, parseUsdCents } from "./chain-analysis.ts";
import type { ChainHolding, ChainObservation } from "./robinhood-chain.ts";
import type { Mandate } from "./decision.ts";
const contract = "0x1111111111111111111111111111111111111111";
const holding: ChainHolding = { symbol:"AAPL", contract, raw:"0x"+(2n*10n**18n).toString(16), decimals:18,
  quantity:"2", status:"ASSET_STATUS_ACTIVE", multiplier:"2.000000000000000000", pendingMultiplier:"" };
const now = Date.now();
function quote(changes: Record<string, unknown> = {}) { return { quotes:[{tokenSymbol:"AAPL",deployments:[{chainId:4663,contractAddress:contract}],
  currency:"USD",bid:"99",ask:"101",isTradingHalt:false,generatedAt:new Date(now).toISOString(),...changes}] }; }
const mandate: Mandate = { version:1,allowedSymbols:["AAPL"],maxOrderCents:100,maxDailyBuyCents:200,maxPositionBps:2000,requireApproval:true };
const base: ChainObservation = { address:contract,chainId:4663,block:"0x42",observedAt:new Date(now).toISOString(),
  eth:"0",usdg:"17.36",scanned:195,holdings:[holding],failures:0,source:"test" };
test("valuation applies multiplier exactly once with precise decimal math",()=>{
  assert.equal(parseUsdCents("1.01"),101);
  assert.equal(parseUsdCents("90071992547409.91"),Number.MAX_SAFE_INTEGER);
  assert.equal(parseUsdCents("90071992547409.92"),null);
  assert.equal(parseUsdCents("1.005"),null);
  assert.equal(decimal18("0.000000000000000001"),1n);
  assert.throws(()=>decimal18("NaN"));assert.throws(()=>decimal18("1e9"));
  const price=priceEvidence(holding,quote(),now);
  assert.equal(price.tokenMid18,(200n*10n**18n).toString());assert.equal(price.valueMicroUsd,"400000000");
});
test("stale, future, halted and mismatched quotes cannot establish value",()=>{
  assert.equal(priceEvidence(holding,quote({generatedAt:new Date(now-121000).toISOString()}),now).state,"stale");
  assert.equal(priceEvidence(holding,quote({generatedAt:new Date(now+20000).toISOString()}),now).valueMicroUsd,null);
  assert.equal(priceEvidence(holding,quote({isTradingHalt:true}),now).state,"halted");
  assert.equal(priceEvidence(holding,quote({deployments:[{chainId:1,contractAddress:contract}]}),now).valueMicroUsd,null);
  assert.equal(priceEvidence({...holding,pendingMultiplier:"3"},quote(),now).valueMicroUsd,null);
  assert.equal(priceEvidence(holding,quote({ask:"98"}),now).valueMicroUsd,null);
});
test("partial prices survive failure without implying full portfolio value or approval",async()=>{
  const fetcher=(async()=>Response.json(quote())) as typeof fetch;
  const record=await enrichObservation(base,mandate,fetcher);
  assert.equal(record.subtotalMicroUsd,"400000000");assert.equal(record.executionReady,false);
  const checks=purchasePreview(record,contract,100,mandate).checks;
  assert.equal(checks.find(c=>c.label==="Single purchase limit")?.state,"pass");
  for(const label of ["Daily purchase limit","Full-wallet concentration","Funds, eligibility and swap route"])
    assert.equal(checks.find(c=>c.label===label)?.state,"pending");
  assert.equal(purchasePreview(record,contract,300,mandate).checks.find(c=>c.label==="Daily purchase limit")?.state,"fail");
  const outage=await enrichObservation({...base,failures:1},null,(async()=>{throw new Error("offline");}) as typeof fetch);
  assert.equal(outage.valuationComplete,false);assert.equal(outage.pricedCount,0);assert.equal(outage.holdings[0].raw,holding.raw);
});
test("comparisons separate quantity, multiplier and price changes and refuse incomplete scans",async()=>{
  const record=await enrichObservation(base,mandate,(async()=>Response.json(quote())) as typeof fetch);
  const changed={...record,holdings:[{...holding,multiplier:"3"}]};
  assert.match(compareObservations(changed,record)[0],/multiplier changed/);
  assert.match(compareObservations({...record,failures:1},record)[0],/incomplete/);
  assert.match(compareObservations({...record,address:"different"},record)[0],/same address/);
});
