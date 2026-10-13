import test from 'node:test';
import assert from 'node:assert/strict';
import {executionAccountingSources} from './execution-sources.ts';
import {CHAIN,USDG} from './robinhood-chain.ts';
const now=Date.parse('2026-10-11T12:00:00Z'),token='0x'+'1'.repeat(40),account='0x'+'2'.repeat(40),blockHash='0x'+'a'.repeat(64);
const anchor={number:'0x10',hash:blockHash,timestamp:'0x'+(BigInt(now)/1000n).toString(16),observedAt:new Date(now).toISOString()};
const asset={tokenSymbol:'AAPL',status:'ASSET_STATUS_ACTIVE',currentMultiplier:'2',deployments:[{chainId:4663,contractAddress:token}]};
function harness(options:{stale?:boolean;wrongDeployment?:boolean;reorg?:boolean;unknown?:boolean;loop?:boolean;badLog?:boolean}={}){
 let headers=0;const pinned:string[]=[];
 const rpc=(async(_url,init)=>{const calls=JSON.parse(String(init?.body));return Response.json(calls.map((c:{id:number;method:string;params:unknown[]})=>{
  let result:unknown;
  if(c.method==='eth_chainId')result=CHAIN.hex;
  else if(c.method==='eth_getBlockByNumber')result={...anchor,hash:options.reorg&&headers++>0?'0x'+'b'.repeat(64):blockHash};
  else if(c.method==='alchemy_getTokenBalances')result={address:account,tokenBalances:options.unknown?[{contractAddress:'0x'+'3'.repeat(40)}]:[],...(options.loop?{pageKey:'again'}:{})};
  else if(c.method==='alchemy_getAssetTransfers')result={transfers:[]};
  else if(c.method==='eth_getLogs')result=options.badLog?[{removed:false,transactionHash:blockHash,blockNumber:anchor.number}]:[];
  else if(c.method==='eth_getBalance'){pinned.push(String(c.params[1]));result='0x0';}
  else if(c.method==='eth_call'){const call=c.params[0] as {data:string;to:string};pinned.push(String(c.params[1]));result='0x'+(call.data==='0x313ce567'?18n:call.to.toLowerCase()===USDG.contract.toLowerCase()?1000000n:1n).toString(16).padStart(64,'0');}
  return {id:c.id,jsonrpc:'2.0',result};
 }));}) as typeof fetch;
 const web=(async(url)=>{if(String(url).endsWith('/assets'))return Response.json({assets:[asset]});if(String(url).includes('coingecko'))return Response.json({'global-dollar':{usd:1,last_updated_at:now/1000-(options.stale?60:0)}});if(String(url).includes('coinbase'))return Response.json({bid:'2000',ask:'2001',time:new Date(now).toISOString()});return Response.json({quotes:[{tokenSymbol:'AAPL',deployments:[{chainId:4663,contractAddress:options.wrongDeployment?account:token}],currency:'USD',bid:'99',ask:'101',isTradingHalt:false,generatedAt:new Date(now-(options.stale?60000:0)).toISOString()}]});}) as typeof fetch;
 return {rpc,web,pinned};
}
test('stock bounds apply corporate multiplier exactly once',async()=>{const h=harness(),s=await executionAccountingSources(anchor,h.rpc,h.web,now);const p=await s.priceBound('AAPL');assert.equal(p?.lowerMicroUsd,'198000000');assert.equal(p?.upperMicroUsd,'202000000');});
test('mismatched deployment cannot provide stock prices',async()=>{const h=harness({wrongDeployment:true}),s=await executionAccountingSources(anchor,h.rpc,h.web,now);assert.equal(await s.priceBound('AAPL'),null);});
test('stale stock and USDG prices fail closed',async()=>{const h=harness({stale:true}),s=await executionAccountingSources(anchor,h.rpc,h.web,now);assert.equal(await s.priceBound('AAPL'),null);assert.equal(await s.priceBound('USDG'),null);});
test('ETH fees use timestamped USD bid and ask',async()=>{const h=harness(),s=await executionAccountingSources(anchor,h.rpc,h.web,now);const p=await s.priceBound('ETH');assert.equal(p?.upperMicroUsd,'2001000000');assert.equal(p?.lowerMicroUsd,'2000000000');});
test('balances use route block and onchain decimals',async()=>{const h=harness(),s=await executionAccountingSources(anchor,h.rpc,h.web,now);const b=await s.balances(account);assert.equal(b?.find(r=>r.symbol==='AAPL')?.decimals,18);assert.ok(h.pinned.length);assert.ok(h.pinned.every(v=>v===anchor.number));});
test('unknown nonzero assets and looping inventory pages fail closed',async()=>{for(const options of [{unknown:true},{loop:true}]){const h=harness(options),s=await executionAccountingSources(anchor,h.rpc,h.web,now);assert.equal(await s.balances(account),null);}});
test('reorg prevents canonical balance proof',async()=>{const h=harness({reorg:true}),s=await executionAccountingSources(anchor,h.rpc,h.web,now);assert.equal(await s.balances(account),null);});
test('closed enhanced history plus independent empty daily logs establishes empty history',async()=>{const h=harness(),s=await executionAccountingSources(anchor,h.rpc,h.web,now);assert.deepEqual(await s.transfers(account),{items:[],complete:true,nativeTransfersComplete:false});});
test('malformed daily logs prevent history coverage',async()=>{const h=harness({badLog:true}),s=await executionAccountingSources(anchor,h.rpc,h.web,now);assert.equal(await s.transfers(account),null);});
test('stale anchors and UTC day boundary require fresh route',async()=>{const h=harness();await assert.rejects(executionAccountingSources({...anchor,observedAt:new Date(now-31000).toISOString()},h.rpc,h.web,now));const midnight=Date.parse('2026-10-12T00:00:00Z');await assert.rejects(executionAccountingSources({...anchor,timestamp:'0x'+BigInt((midnight-1000)/1000).toString(16),observedAt:new Date(midnight).toISOString()},h.rpc,h.web,midnight),/UTC budget/);});
