import test from 'node:test';import assert from 'node:assert/strict';import {alchemyAccountingSources,liveAccountingSection,grantGateSection} from './live-evidence.ts';import {mandateDigest,type MandateSnapshot,type PolicyLease} from './policy-lease.ts';import type {SpendEvidence} from '../db/execution-attempts.ts';import type {Mandate} from './decision.ts';
const now=Date.now(),at=(ms:number=now)=>new Date(ms).toISOString();
const ADDR='0x'+'a'.repeat(40),AAPL='0x'+'1'.repeat(40),USDG='0x'+'2'.repeat(40),VENUE='0x'+'3'.repeat(40),HASH=(c:string)=>'0x'+c.repeat(64);
const ledger=():SpendEvidence=>({reservedRaw:'0',filledCents:0,pendingCents:0,knownHashes:[],confirmedHashes:[]});
const mandate=():Mandate=>({version:3,allowedSymbols:['AAPL'],maxOrderCents:100,maxDailyBuyCents:200,maxPositionBps:2000,requireApproval:true});
const rpcJson=(result:unknown)=>Response.json({jsonrpc:'2.0',id:1,result});
function fixtureFetchers(overrides:{rpc?:typeof fetch;web?:typeof fetch}={}){
 const rpc:typeof fetch=overrides.rpc??(async(input,init)=>{
  const body=JSON.parse(String(init?.body??'{}')) as{method:string;params:unknown[]};
  if(body.method==='eth_blockNumber')return rpcJson('0x10');
  if(body.method==='eth_getBlockByNumber')return rpcJson({number:'0x10',hash:HASH('b')});
  if(body.method==='eth_getBalance')return rpcJson('0x0');
  if(body.method==='alchemy_getTokenBalances')return rpcJson({tokenBalances:[
   {contractAddress:USDG,tokenBalance:'0x'+BigInt('5000000').toString(16)},
   {contractAddress:AAPL,tokenBalance:'0x'+BigInt('1000000000000000000').toString(16)}]});
  if(body.method==='alchemy_getTokenMetadata')return rpcJson({symbol:String(body.params[0])===USDG?'USDG':'AAPL',decimals:String(body.params[0])===USDG?6:18});
  if(body.method==='alchemy_getAssetTransfers')return rpcJson({transfers:[]});
  return rpcJson(null);
 });
 const web:typeof fetch=overrides.web??(async(input)=>{
  const url=String(input);
  if(url.includes('coingecko'))return Response.json({'global-dollar':{usd:1,last_updated_at:Math.floor(now/1000)}});
  if(url.includes('binance'))return Response.json({bidPrice:'2699.03',askPrice:'2699.04'});
  if(url.includes('rhj/prices/AAPL'))return Response.json({quotes:[{tokenSymbol:'AAPL',deployments:[{chainId:4663}],bid:'330.00',ask:'334.00',currency:'USD',isTradingHalt:false,generatedAt:at()}]});
  return Response.json({});
 });
 return {rpc,web};
}
test('alchemy sources assemble complete inventory and two-sided bounds',async()=>{
 const sources=alchemyAccountingSources(fixtureFetchers().rpc,fixtureFetchers().web);
 const block=await sources.block();assert.deepEqual(block,{hash:HASH('b'),observedAt:block!.observedAt});
 const balances=await sources.balances(ADDR);
 assert.deepEqual(balances?.map(b=>b.symbol),['ETH','USDG','AAPL']);
 assert.equal(balances?.[1].raw,'5000000');
 const history=await sources.transfers(ADDR);
 assert.deepEqual(history,{items:[],complete:true});
 const usdg=await sources.priceBound('USDG');assert.deepEqual([usdg!.upperMicroUsd,usdg!.lowerMicroUsd],['1005000','995000']);
 const eth=await sources.priceBound('ETH');assert.deepEqual([eth!.upperMicroUsd,eth!.lowerMicroUsd],['2699040000','2699030000']);
 const stock=await sources.priceBound('AAPL');assert.deepEqual([stock!.upperMicroUsd,stock!.lowerMicroUsd],['334000000','330000000']);
 assert.equal(await sources.priceBound('HALTED'),null);
});
test('incomplete sources fail closed instead of returning partial evidence',async()=>{
 const badRpc=async()=>Response.json({jsonrpc:'2.0',id:1,error:{code:-1}});
 const sources=alchemyAccountingSources(badRpc as typeof fetch,fixtureFetchers().web);
 assert.equal(await sources.block(),null);assert.equal(await sources.balances(ADDR),null);assert.equal(await sources.transfers(ADDR),null);
 const capped=alchemyAccountingSources(fixtureFetchers({rpc:async(input,init)=>{
  const body=JSON.parse(String(init?.body??'{}')) as{method:string};
  if(body.method==='alchemy_getTokenBalances')return rpcJson({tokenBalances:Array.from({length:31},()=>({contractAddress:USDG,tokenBalance:'0x1'}))});
  return fixtureFetchers().rpc(input,init);
 }}).rpc,fixtureFetchers().web);
 assert.equal(await capped.balances(ADDR),null);
 const unclosed=alchemyAccountingSources(fixtureFetchers({rpc:async(input,init)=>{
  const body=JSON.parse(String(init?.body??'{}')) as{method:string};
  if(body.method==='alchemy_getAssetTransfers')return rpcJson({transfers:[],pageKey:'more'});
  return fixtureFetchers().rpc(input,init);
 }}).rpc,fixtureFetchers().web);
 assert.equal(await unclosed.transfers(ADDR),null);
});
test('the live section reports assembled evidence with per-target context',async()=>{
 const sources=alchemyAccountingSources(fixtureFetchers().rpc,fixtureFetchers().web);
 const section=await liveAccountingSection(ADDR,mandate(),ledger(),sources,now);
 assert.equal(section.executionEnabled,false);assert.equal(section.assembled,true);assert.deepEqual(section.gaps,[]);
 assert.equal(section.ledgerSource,'owner-ledger');
 assert.equal(section.targets.length,1);
 assert.deepEqual(section.targets[0],{symbol:'AAPL',gaps:[],portfolioTotalMicroUsd:'339025000',positionMicroUsd:'334000000',externalBuysTodayCents:0});
 const missing=await liveAccountingSection(ADDR,mandate(),null,sources,now);
 assert.equal(missing.assembled,false);assert.equal(missing.ledgerSource,'unavailable');assert.ok(missing.gaps.length>0);
 const noMandate=await liveAccountingSection(ADDR,null,ledger(),sources,now);
 assert.equal(noMandate.assembled,false);assert.ok(noMandate.gaps.length>0);
});
test('the grant gate reports the true lifecycle state',()=>{
 const snapshot: MandateSnapshot={owner:'0x'+'6'.repeat(40),version:3,policyJson:'{"maxDailyCents":200}'};
 const lease:PolicyLease={schema:'stock-steward-policy-lease-v1',owner:snapshot.owner,account:ADDR,session:'0x'+'7'.repeat(40),roleKey:HASH('1'),grantId:HASH('2'),policyHash:HASH('3'),mandateVersion:3,mandateDigest:mandateDigest(snapshot),signerCiphertextRef:'sessions/3/iv',boundAt:at(),state:'active',revocationDigest:null,revokedAt:null};
 const empty=grantGateSection([],snapshot,now);
 assert.deepEqual([empty.activeGrants,empty.driftedGrants,empty.executionEnabled],[0,0,false]);
 assert.match(empty.why,/No spending grant/);
 const healthy=grantGateSection([lease],snapshot,now);
 assert.deepEqual([healthy.activeGrants,healthy.driftedGrants],[1,0]);
 const drifted=grantGateSection([lease],{...snapshot,version:4},now);
 assert.deepEqual([drifted.activeGrants,drifted.driftedGrants],[1,1]);
 assert.match(drifted.why,/revoke/);
 const revoked=grantGateSection([{...lease,state:'revoked'}],snapshot,now);
 assert.equal(revoked.activeGrants,0);
});
