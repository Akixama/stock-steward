import test from 'node:test';import assert from 'node:assert/strict';import {buildAccountingEvidence,type AccountingSources,type ObservedTransfer} from './live-accounting.ts';import {executionAccounting} from './execution-accounting.ts';
const now=Date.parse('2026-10-06T12:00:00Z'),at=(ms:number=now)=>new Date(ms).toISOString(),day='2026-10-06';
const ADDR='0x'+'a'.repeat(40),AAPL='0x'+'1'.repeat(40),USDG='0x'+'2'.repeat(40),VENUE='0x'+'3'.repeat(40);
const HASH=(c:string)=>'0x'+c.repeat(64);
const ledger={reservedRaw:'0',filledCents:0,pendingCents:0,knownHashes:[] as string[],confirmedHashes:[] as string[]};
const fixture=(overrides:Partial<AccountingSources>={}):AccountingSources=>({
 block:async()=>({hash:HASH('b'),observedAt:at()}),
 balances:async()=>[{symbol:'USDG',token:USDG,raw:'5000000',decimals:6},{symbol:'AAPL',token:AAPL,raw:'1000000000000000000',decimals:18}],
 transfers:async()=>({items:[],complete:true}),
 priceBound:async(symbol)=>symbol==='USDG'
  ?{upperMicroUsd:'1005000',lowerMicroUsd:'995000',priceAt:at(),source:'fixture-stablecoin-venue'}
  :{upperMicroUsd:'334000000',lowerMicroUsd:'330000000',priceAt:at(),source:'fixture-equity-venue'},
 ...overrides,
});
const externalBuy=(hash=HASH('c'),buyDay=day):ObservedTransfer[]=>[
 {hash,from:ADDR,to:VENUE,symbol:'USDG',token:USDG,raw:'1000000',decimals:6,day:buyDay},
 {hash,from:VENUE,to:ADDR,symbol:'AAPL',token:AAPL,raw:'1000000000000000000',decimals:18,day:buyDay},
];
const limits={maxOrderCents:150,maxDailyCents:250,maxPositionBps:10000};

test('complete live evidence assembles and satisfies exact dollar accounting',async()=>{
 const a=await buildAccountingEvidence(ADDR,'AAPL','1000000',ledger,fixture(),now);
 assert.deepEqual(a.gaps,[]);assert.ok(a.evidence);
 // Valuations use the upper bound and round upwards: 5 USDG at 1.005 and 1 AAPL at 334.
 assert.equal(a.evidence.portfolio.totalMicroUsd,'339025000');
 assert.equal(a.evidence.portfolio.positionMicroUsd,'334000000');
 const r=executionAccounting(a.evidence,'1000000',limits,now);
 assert.equal(r.checksPassed,true,JSON.stringify(r.checks));
 assert.equal(r.proposedCents,'101');assert.equal(r.executionEnabled,false);
});
test('missing block, inventory or complete history fails closed instead of zeroing',async()=>{
 for(const overrides of [{block:async()=>null},{balances:async()=>null},{transfers:async()=>null},{transfers:async()=>({items:[],complete:false})}] as Partial<AccountingSources>[]){
  const a=await buildAccountingEvidence(ADDR,'AAPL','1000000',ledger,fixture(overrides),now);
  assert.equal(a.evidence,null);assert.ok(a.gaps.length>0);
 }
});
test('unpriced, unbounded or stale prices block inventory and verification',async()=>{
 for(const priceBound of [async()=>null,async()=>({upperMicroUsd:'0',lowerMicroUsd:'0',priceAt:at(),source:'bad'}),async()=>({upperMicroUsd:'334000000',lowerMicroUsd:'330000000',priceAt:at(now-31000),source:'stale'}),async()=>({upperMicroUsd:'330000000',lowerMicroUsd:'334000000',priceAt:at(),source:'inverted'})] as AccountingSources['priceBound'][]){
  const a=await buildAccountingEvidence(ADDR,'AAPL','1000000',ledger,fixture({priceBound}),now);
  assert.equal(a.evidence,null);assert.ok(a.gaps.length>0);
 }
});
test('external buys count against the daily ceiling at an upper bound; steward hashes are not double counted',async()=>{
 const asExternal=await buildAccountingEvidence(ADDR,'AAPL','1000000',ledger,fixture({transfers:async()=>({items:externalBuy(),complete:true})}),now);
 assert.ok(asExternal.evidence);assert.equal(asExternal.externalBuysTodayCents,33400);
 assert.equal(asExternal.evidence.daily.filledCents,33400);
 const asSteward=await buildAccountingEvidence(ADDR,'AAPL','1000000',{...ledger,filledCents:50,knownHashes:[HASH('c')]},fixture({transfers:async()=>({items:externalBuy(),complete:true})}),now);
 assert.ok(asSteward.evidence);assert.equal(asSteward.externalBuysTodayCents,0);
 assert.equal(asSteward.evidence.daily.filledCents,50);
 assert.equal(asSteward.activity[0].kind,'steward');
 const oldBuy=await buildAccountingEvidence(ADDR,'AAPL','1000000',ledger,fixture({transfers:async()=>({items:externalBuy(HASH('c'),'2026-10-05'),complete:true})}),now);
 assert.ok(oldBuy.evidence);assert.equal(oldBuy.externalBuysTodayCents,0);
 assert.equal(oldBuy.activity[0].kind,'external_buy');
});
test('unexplained movements and missing confirmed transactions block reconciliation',async()=>{
 const weird:ObservedTransfer={hash:HASH('d'),from:VENUE,to:ADDR,symbol:'XYZ',token:'0x'+'4'.repeat(40),raw:'1',decimals:18,day};
 const a=await buildAccountingEvidence(ADDR,'AAPL','1000000',ledger,fixture({transfers:async()=>({items:[weird],complete:true})}),now);
 assert.equal(a.evidence,null);assert.equal(a.activity[0].kind,'unknown');
 const b=await buildAccountingEvidence(ADDR,'AAPL','1000000',{...ledger,confirmedHashes:[HASH('f')]},fixture(),now);
 assert.equal(b.evidence,null);assert.ok(b.gaps.some(g=>g.includes(HASH('f'))));
});
test('native gas funding and withdrawals are explained money movements',async()=>{
 const funding:ObservedTransfer={hash:HASH('e'),from:VENUE,to:ADDR,symbol:'ETH',token:'0x'+'0'.repeat(40),raw:'100000000000000000',decimals:18,day};
 const a=await buildAccountingEvidence(ADDR,'AAPL','1000000',ledger,fixture({transfers:async()=>({items:[funding],complete:true})}),now);
 assert.deepEqual(a.gaps,[]);assert.ok(a.evidence);assert.equal(a.activity[0].kind,'funding');
});
test('an empty account assembles complete zero evidence and still cannot spend',async()=>{
 const a=await buildAccountingEvidence(ADDR,'AAPL','1000000',ledger,fixture({balances:async()=>[]}),now);
 assert.deepEqual(a.gaps,[]);assert.ok(a.evidence);assert.equal(a.evidence.settlement.balanceRaw,'0');
 assert.equal(a.evidence.portfolio.totalMicroUsd,'0');
 const r=executionAccounting(a.evidence,'1000000',limits,now);
 assert.equal(r.checksPassed,false);
 assert.equal(r.checks.find(c=>c.name==='Unreserved settlement funds')?.state,'fail');
});
test('a single-asset portfolio keeps position within total at one valuation side',async()=>{
 const a=await buildAccountingEvidence(ADDR,'AAPL','1000000',ledger,fixture({balances:async()=>[{symbol:'AAPL',token:AAPL,raw:'1000000000000000000',decimals:18}]}),now);
 assert.deepEqual(a.gaps,[]);assert.ok(a.evidence);
 assert.equal(a.evidence.portfolio.totalMicroUsd,a.evidence.portfolio.positionMicroUsd);
 assert.equal(a.evidence.settlement.balanceRaw,'0');
});
test('malformed requests are rejected before any source is consulted',async()=>{
 for(const [address,symbol,loss,led] of [['bad','AAPL','1000000',ledger],[ADDR,'AAPL','0',ledger],[ADDR,'AAPL','x',ledger],[ADDR,'AAPL','1000000',{...ledger,reservedRaw:'-1'}],[ADDR,'lower','1000000',ledger]] as const){
  const a=await buildAccountingEvidence(address,symbol,loss,led,fixture(),now);
  assert.equal(a.evidence,null);assert.match(a.gaps[0],/Malformed/);
 }
});
