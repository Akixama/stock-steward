import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,parseAbi,type Address} from 'viem';
import {ownerTransferTransaction} from './previous-wallet-transfer.ts';
import {ownerSaleTransaction} from './owner-sale.ts';
import {poolIdentity,VENUE,type RouteEvidence} from './chain-route.ts';
import {reconcileWalletAction,type SavedWalletAction} from './wallet-action-reconcile.ts';
import {CHAIN,USDG} from './robinhood-chain.ts';

const owner=('0x'+'a'.repeat(40)) as `0x${string}`;
const safe=('0x'+'b'.repeat(40)) as `0x${string}`;
const txHash='0x'+'1'.repeat(64);
const blockHash='0x'+'2'.repeat(64);
const finalHash='0x'+'3'.repeat(64);
const amount=1_000_000n;
const transaction=ownerTransferTransaction({safe,owner,token:USDG.contract,amount});
const row:SavedWalletAction={kind:'transfer',symbol:'USDG',quantity:'1',owner_address:owner,safe,transaction_json:JSON.stringify(transaction),transaction_hash:txHash};
const eventAbi=parseAbi(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const log={address:USDG.contract,topics:encodeEventTopics({abi:eventAbi,eventName:'Transfer',args:{from:safe,to:owner}}),data:encodeAbiParameters([{type:'uint256'}],[amount]),transactionHash:txHash,blockHash,logIndex:'0x0'};

function rpcFixture(options:{status?:string;receipt?:boolean;logs?:unknown[];finalized?:boolean;head?:string;reorged?:boolean;transaction?:{from:string;to:string;data:string;value:string}}={}){
 const seen:string[]=[];
 const fetcher=async(_input:unknown,init?:RequestInit)=>{
  const payload=JSON.parse(String(init?.body)) as {id:number;method:string;params:unknown[]};seen.push(payload.method);
  const result=payload.method==='eth_chainId'?CHAIN.hex:
   payload.method==='eth_getTransactionByHash'?{hash:txHash,from:options.transaction?.from??owner,to:options.transaction?.to??safe,input:options.transaction?.data??transaction.data,value:options.transaction?.value??'0x0',blockHash,blockNumber:'0x10'}:
   payload.method==='eth_getTransactionReceipt'?options.receipt===false?null:{transactionHash:txHash,blockHash,blockNumber:'0x10',status:options.status??'0x1',logs:options.logs??[log]}:
   payload.method==='eth_blockNumber'?(options.head??'0x12'):
   payload.method==='eth_getBlockByNumber'&&payload.params[0]==='finalized'?options.finalized===false?{hash:finalHash,number:'0xf'}:{hash:finalHash,number:'0x11'}:
   payload.method==='eth_getBlockByNumber'&&payload.params[0]==='0x11'?{hash:finalHash,number:'0x11'}:
   payload.method==='eth_getBlockByNumber'?{hash:options.reorged?finalHash:blockHash,number:'0x10'}:null;
  return new Response(JSON.stringify({jsonrpc:'2.0',id:payload.id,result}),{status:200});
 };
 return {fetcher:fetcher as typeof fetch,seen};
}

test('finalized exact transfer confirms with proved amount',async()=>{
 const {fetcher}=rpcFixture();const result=await reconcileWalletAction(row,fetcher);
 assert.equal(result.state,'confirmed');assert.equal(result.inputRaw,amount.toString());assert.equal(result.blockNumber,'0x10');
});
test('finalized revert is terminal without claiming funds moved',async()=>{
 const {fetcher}=rpcFixture({status:'0x0',logs:[]});const result=await reconcileWalletAction(row,fetcher);
 assert.equal(result.state,'reverted');assert.equal(result.inputRaw,undefined);
});
test('successful receipt without exact token proof remains unknown',async()=>{
 const {fetcher}=rpcFixture({logs:[]});assert.equal((await reconcileWalletAction(row,fetcher)).state,'unknown');
});
test('saved hash before receipt exists remains unknown and is not resent',async()=>{
 const {fetcher,seen}=rpcFixture({receipt:false});assert.equal((await reconcileWalletAction(row,fetcher)).state,'unknown');
 assert.equal(seen.includes('eth_sendTransaction'),false);
});
test('included but unfinalized receipt remains unknown',async()=>{
 const {fetcher}=rpcFixture({finalized:false});assert.equal((await reconcileWalletAction(row,fetcher)).state,'unknown');
});
test('exact unfinalized movement becomes informationally confirmed after enough blocks',async()=>{
 const {fetcher}=rpcFixture({finalized:false,head:'0x20'});const proof=await reconcileWalletAction(row,fetcher);
 assert.equal(proof.state,'unknown');assert.equal(proof.confirmation,'confirmed');assert.equal(proof.inputRaw,amount.toString());
});
test('early reverted receipt and changed canonical block never settle an action',async()=>{
 const reverted=await reconcileWalletAction(row,rpcFixture({finalized:false,head:'0x20',status:'0x0',logs:[]}).fetcher);
 assert.equal(reverted.state,'unknown');assert.equal(reverted.confirmation,'reverted');
 const reorged=await reconcileWalletAction(row,rpcFixture({finalized:false,head:'0x20',reorged:true}).fetcher);
 assert.equal(reorged.state,'unknown');assert.equal(reorged.confirmation,'reorged');
});
test('finalized sale needs exact stock outflow and bounded USDG inflow',async()=>{
 const stock='0x1111111111111111111111111111111111111111' as Address;
 const pool=poolIdentity(stock,3000,60);
 const route:RouteEvidence={side:'sell',id:'test',chainId:4663,address:safe,symbol:'AAPL',token:stock,settlement:VENUE.settlement,input:'0.02',inputRaw:'20000000000000000',settlementDecimals:6,block:'0x1',blockHash,blockAt:new Date().toISOString(),observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30000).toISOString(),balanceRaw:'20000000000000000',slippageBps:50,probes:[],best:{fee:3000,tickSpacing:60,poolId:pool.poolId,state:'quoted',outputRaw:'7000000',reason:'test'},minimumOutputRaw:'6965000',executionEnabled:false,coverage:'',blockers:[]};
 const sale=ownerSaleTransaction(route,owner);
 const saleRow:SavedWalletAction={kind:'sell',symbol:'AAPL',quantity:'0.02',owner_address:owner,safe,transaction_json:JSON.stringify(sale),transaction_hash:txHash};
 const movement=(token:string,from:string,to:string,value:bigint,index:number)=>({address:token,topics:encodeEventTopics({abi:eventAbi,eventName:'Transfer',args:{from:from as Address,to:to as Address}}),data:encodeAbiParameters([{type:'uint256'}],[value]),transactionHash:txHash,blockHash,logIndex:`0x${index.toString(16)}`});
 const logs=[movement(stock,safe,VENUE.manager,20_000_000_000_000_000n,0),movement(USDG.contract,VENUE.manager,safe,7_000_000n,1)];
 const {fetcher}=rpcFixture({transaction:sale,logs});const result=await reconcileWalletAction(saleRow,fetcher);
 assert.equal(result.state,'confirmed',result.reason);assert.equal(result.outputRaw,'7000000');
 const missing=rpcFixture({transaction:sale,logs:logs.slice(0,1)});
 assert.equal((await reconcileWalletAction(saleRow,missing.fetcher)).state,'unknown');
});
