import test from 'node:test';import assert from 'node:assert/strict';import {reconcileTransaction} from './chain-reconciliation.ts';
const address='0x'+'a'.repeat(40),hash='0x'+'b'.repeat(64),blockHash='0x'+'c'.repeat(64);
function provider(overrides:Record<string,unknown>={}){return (async(_url,init)=>{const {method,params}=JSON.parse(init?.body as string);let result:unknown;
  if(method==='eth_chainId')result='0x1237';if(method==='eth_getTransactionByHash')result={hash,from:address,to:null};
  if(method==='eth_getTransactionReceipt')result={transactionHash:hash,blockNumber:'0x10',blockHash,status:'0x1'};
  if(method==='eth_getBlockByNumber')result={number:params[0]==='finalized'?'0x10':params[0],hash:blockHash};if(method==='eth_blockNumber')result='0x12';
  if(Object.hasOwn(overrides,method))result=overrides[method];return Response.json({result});}) as typeof fetch;}
test('canonical finalized outer success remains unverified investment evidence',async()=>{
  const record=await reconcileTransaction(address,hash,null,provider());assert.equal(record.state,'rpc_finalized_success');assert.equal(record.confirmations,'3');assert.equal(record.investmentOutcome,'unverified');
  assert.match(record.why,/does not modify/);
});
test('network outage, missing receipts, mismatched addresses and wrong chain never become fills',async()=>{
  const included=await reconcileTransaction(address,hash,null,provider());
  assert.equal((await reconcileTransaction(address,hash,included,(async()=>{throw new Error('outage');}) as typeof fetch)).state,'unknown');
  assert.equal((await reconcileTransaction(address,hash,included,provider({eth_getTransactionReceipt:null}))).state,'reorged');
  assert.equal((await reconcileTransaction(address,hash,null,provider({eth_getTransactionReceipt:null}))).state,'pending');
  assert.equal((await reconcileTransaction(address,hash,null,provider({eth_chainId:'0x1'}))).state,'unknown');
  assert.equal((await reconcileTransaction(address,hash,null,provider({eth_getTransactionByHash:{hash,from:'0x'+'d'.repeat(40),to:null}}))).state,'address_mismatch');
});
test('noncanonical receipt and reverted outer transaction cannot be treated as settlement',async()=>{
  assert.equal((await reconcileTransaction(address,hash,null,provider({eth_getBlockByNumber:{number:'0x10',hash:'0x'+'d'.repeat(64)}}))).state,'reorged');
  assert.equal((await reconcileTransaction(address,hash,null,provider({eth_getTransactionReceipt:{transactionHash:hash,blockNumber:'0x10',blockHash,status:'0x0'}}))).state,'rpc_finalized_reverted');
});
