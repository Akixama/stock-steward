import test from 'node:test';
import assert from 'node:assert/strict';
import {executionSaleAccounting,type AccountingEvidence} from './execution-accounting.ts';
const now=Date.parse('2026-10-12T12:00:00Z'),stamp=new Date(now).toISOString();
const limits={maxOrderCents:1000,maxDailyCents:5000,maxPositionBps:5000};
const evidence=():AccountingEvidence=>({address:'0x'+'a'.repeat(40),chainId:4663,blockHash:'0x'+'b'.repeat(64),observedAt:stamp,inventoryComplete:true,externalActivityReconciled:true,priceSourcesVerified:true,settlement:{balanceRaw:'1000000000000000000',reservedRaw:'0',decimals:18,upperMicroUsdPerToken:'100000000',priceAt:stamp,source:'verified'},portfolio:{totalMicroUsd:'200000000',positionMicroUsd:'100000000',maximumLossMicroUsd:'100000'},daily:{day:'2026-10-12',filledCents:5000,pendingCents:0},sale:{inputToken:'0x'+'c'.repeat(40),outputToken:'0x'+'d'.repeat(40),minimumOutputRaw:'9900000',outputDecimals:6,outputLowerMicroUsdPerToken:'1000000',outputPriceAt:stamp,outputPriceSource:'verified'}});
const amount='100000000000000000';
test('sale accounting uses stock decimals and preserves exhausted buy budgets',()=>{
 const result=executionSaleAccounting(evidence(),amount,limits,now);
 assert.equal(result.checksPassed,true);assert.equal(result.proposedCents,'1000');assert.ok(BigInt(result.projectedBps!)<5000n);assert.ok(result.digest);
});
test('sales reject shorting, stale output prices, malformed holdings and incomplete evidence',()=>{
 for(const edit of [(e:AccountingEvidence)=>{e.settlement.reservedRaw=e.settlement.balanceRaw;},(e:AccountingEvidence)=>{e.sale!.outputPriceAt=new Date(now-31000).toISOString();},(e:AccountingEvidence)=>{e.portfolio.positionMicroUsd='1';},(e:AccountingEvidence)=>{e.inventoryComplete=false;},(e:AccountingEvidence)=>{delete e.sale;}]){
  const e=evidence();edit(e);assert.equal(executionSaleAccounting(e,amount,limits,now).checksPassed,false);
 }
 assert.equal(executionSaleAccounting(evidence(),'100000000000000001',limits,now).checksPassed,false);
});
