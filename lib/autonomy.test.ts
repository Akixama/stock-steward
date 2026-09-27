import {attachHistoricalControl} from './autonomy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {autonomyReadiness, readInfrastructure,transitionSpend,executionDay} from './autonomy.ts';
import {quoteSetup,type SetupFeeEvidence} from './autonomy-fees.ts';
test('code at routers and automatic preference never create spending authority',()=>{
  const now=new Date('2026-09-26T12:00:00Z');
  const receipt=autonomyReadiness('0x'+'a'.repeat(40),{version:2,allowedSymbols:['AAPL'],maxOrderCents:100,maxDailyBuyCents:100,maxPositionBps:2000,executionPreference:'automatic',requireApproval:true},
    {chainId:4663,block:'0x12',gasPriceWei:'1',contracts:{router:20,delegate:20,permit2:20},observedAt:now.toISOString()},now);
  assert.equal(receipt.executionEnabled,false);assert.equal(receipt.status,'blocked');
  assert.equal(receipt.checks.find(c=>c.name==='Mainnet infrastructure')?.state,'pass');
  assert.ok(receipt.nextSteps.includes('Bounded execution permission'));
  assert.equal(autonomyReadiness(receipt.address,null,null,now).checks.find(c=>c.name==='Mainnet infrastructure')?.state,'pending');
});
test('infrastructure rejects counterfeit networks before code reads and pins one block',async()=>{
  const calls:{method:string;params:unknown[]}[]=[];
  const fetcher=(async(_url,init)=>{const body=JSON.parse(init?.body as string);calls.push(body);
    return Response.json({result:body.method==='eth_chainId'?'0x1237':body.method==='eth_blockNumber'?'0x88':body.method==='eth_gasPrice'?'0xa':'0x1234'});}) as typeof fetch;
  const result=await readInfrastructure(fetcher);assert.equal(result.contracts.router,2);
  assert.ok(calls.filter(c=>c.method==='eth_getCode').every(c=>c.params[1]==='0x88'));
  await assert.rejects(readInfrastructure((async()=>Response.json({result:'0x1'})) as typeof fetch),/Wrong network/);
});
test('unknown submissions cannot return to reserved or silently release accounting',()=>{
  assert.equal(transitionSpend('reserved','unknown'),'unknown');
  assert.throws(()=>transitionSpend('unknown','reserved'));
  assert.throws(()=>transitionSpend('confirmed','released'));
  assert.equal(executionDay(new Date('2026-09-27T00:00:00Z')),'2026-09-27');
});
test('setup cap includes all three steps, data and provider fees, headroom and freshness',()=>{
  const now=Date.parse('2026-09-26T12:00:00Z');
  const evidence:SetupFeeEvidence={observedAt:new Date(now).toISOString(),ethPriceAt:new Date(now).toISOString(),ethUsdCents:300000,
    steps:['delegation','permission','revocation'].map(name=>({name:name as 'delegation'|'permission'|'revocation',executionGas:'100000',maxFeePerGasWei:'1000000000',dataFeeWei:'100000000000000',providerFeeWei:'0'}))};
  assert.equal(quoteSetup(evidence,2000,now).bufferedCents,'270');
  assert.equal(quoteSetup(evidence,100,now).withinCap,false);
  assert.throws(()=>quoteSetup({...evidence,steps:evidence.steps.slice(0,2)},2000,now));
  assert.throws(()=>quoteSetup(evidence,2000,now+61000));
});

test('matching historical control is displayed without granting delegation or execution',()=>{const address='0x'+'a'.repeat(40),receipt=autonomyReadiness(address,null,null);attachHistoricalControl(receipt,{address,verifiedAt:'2026-09-27T12:00:00Z'});attachHistoricalControl(receipt,{address,verifiedAt:'2026-09-27T12:00:00Z'});assert.equal(receipt.checks.filter(c=>c.name==='Historical wallet control').length,1);assert.equal(receipt.checks.find(c=>c.name==='Wallet ownership and delegation')?.state,'pending');assert.equal(receipt.executionEnabled,false);for(const ownership of [null,{address:'0x'+'b'.repeat(40),verifiedAt:'2026-09-27T12:00:00Z'},{address,verifiedAt:null}]){const other=autonomyReadiness(address,null,null);attachHistoricalControl(other,ownership);assert.equal(other.checks.some(c=>c.name==='Historical wallet control'),false);}});
