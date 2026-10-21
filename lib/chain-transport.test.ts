import test from 'node:test';
import assert from 'node:assert/strict';
import { chainTransport } from './chain-transport.ts';
import { CHAIN } from './robinhood-chain.ts';

const okResponse = () => ({ ok: true, status: 200 }) as unknown as Response;
const badResponse = () => ({ ok: false, status: 400 }) as unknown as Response;

async function flakyOnce(calls: { count: number }): Promise<Response> {
  calls.count++;
  if (calls.count === 1) throw new Error('socket hang up');
  return okResponse();
}

async function alwaysDown(calls: { count: number }): Promise<Response> {
  calls.count++;
  throw new Error('connection reset');
}

test('a single network failure is retried once, then succeeds', async () => {
  const calls = { count: 0 };
  const upstream = ((..._args: unknown[]) => flakyOnce(calls)) as unknown as typeof fetch;
  const transport = chainTransport('key123', upstream);
  const response = await transport(CHAIN.rpc, { method: 'POST' });
  assert.equal(response.ok, true);
  assert.equal(calls.count, 2);
});

test('persistent failure throws after two attempts', async () => {
  const calls = { count: 0 };
  const upstream = ((..._args: unknown[]) => alwaysDown(calls)) as unknown as typeof fetch;
  const transport = chainTransport('key123', upstream);
  await assert.rejects(transport(CHAIN.rpc, { method: 'POST' }), /RPC transport unavailable/);
  assert.equal(calls.count, 2);
});

test('a caller timeout keeps a single attempt', async () => {
  const calls = { count: 0 };
  const upstream = ((..._args: unknown[]) => alwaysDown(calls)) as unknown as typeof fetch;
  const transport = chainTransport(undefined, upstream);
  await assert.rejects(
    transport('https://api.robinhood.com/rhj/assets', { signal: AbortSignal.timeout(1000) }),
    /Registry transport unavailable/);
  assert.equal(calls.count, 1);
});

test('an HTTP error passes through without throwing', async () => {
  const upstream = (async () => badResponse()) as unknown as typeof fetch;
  const transport = chainTransport('key123', upstream);
  const response = await transport(CHAIN.rpc, { method: 'POST' });
  assert.equal(response.ok, false);
});
test('worker subrequest limits are not retried',async()=>{let calls=0;const upstream=(async()=>{calls++;throw Error('Too many subrequests.');}) as typeof fetch;await assert.rejects(chainTransport('key123',upstream)(CHAIN.rpc,{method:'POST'}),/read limit/);assert.equal(calls,1);});
test('an incomplete read-only RPC response is retried once, including with a caller timeout',async()=>{
  let calls=0;
  const upstream=(async()=>{calls++;return calls===1?new Response('',{status:200}):Response.json({jsonrpc:'2.0',id:1,result:'0x1'});}) as typeof fetch;
  const response=await chainTransport('key123',upstream)(CHAIN.rpc,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[]}),signal:AbortSignal.timeout(2000)});
  assert.equal((await response.json() as {result:string}).result,'0x1');assert.equal(calls,2);
});
test('an incomplete chain read fails clearly after one retry; a send is never retried',async()=>{
  let reads=0,sends=0;
  const upstream=(async(_url,init)=>{
    const method=JSON.parse(String(init?.body)).method;
    if(method==='eth_call')reads++;else sends++;
    return new Response('<!DOCTYPE html>',{status:200});
  }) as typeof fetch;
  const transport=chainTransport('key123',upstream);
  await assert.rejects(transport(CHAIN.rpc,{method:'POST',body:JSON.stringify({method:'eth_call'})}),/incomplete response/);
  assert.equal(reads,2);
  const response=await transport(CHAIN.rpc,{method:'POST',body:JSON.stringify({method:'eth_sendRawTransaction'})});
  assert.equal(response.status,200);assert.equal(sends,1);
});
test('receipt headers stay public while historical state goes to the configured archive provider',async()=>{const {receiptTransport}=await import('./chain-transport.ts');const urls:string[]=[];const transport=receiptTransport('key123',(async(url)=>{urls.push(String(url));return Response.json({result:'0x'});}) as typeof fetch);for(const method of ['eth_getTransactionReceipt','eth_getBlockByNumber','eth_getCode','eth_call'])await transport(CHAIN.rpc,{method:'POST',body:JSON.stringify({method})});assert.deepEqual(urls,[CHAIN.rpc,CHAIN.rpc,'https://robinhood-mainnet.g.alchemy.com/v2/key123','https://robinhood-mainnet.g.alchemy.com/v2/key123']);});

const readBody=JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:'0x123',data:'0x'},'latest']});

test('read-only RPC error logs safe method and code, then falls back to public RPC',async()=>{
  const urls:string[]=[];const logged:unknown[][]=[];const original=console.error;
  console.error=(...args:unknown[])=>{logged.push(args);};
  try{
    const upstream=(async(url)=>{urls.push(String(url));return urls.length===1
      ?Response.json({jsonrpc:'2.0',id:1,error:{code:-32005,message:'secret provider detail'}})
      :Response.json({jsonrpc:'2.0',id:1,result:'0x01'});}) as typeof fetch;
    const response=await chainTransport('key123',upstream)(CHAIN.rpc,{method:'POST',body:readBody});
    assert.equal((await response.json() as {result:string}).result,'0x01');
    assert.deepEqual(urls,['https://robinhood-mainnet.g.alchemy.com/v2/key123',CHAIN.rpc]);
    assert.deepEqual(logged.find(entry=>entry[0]==='chain_dependency_rpc_error')?.[1],
      {provider:'alchemy',method:'eth_call',code:-32005,status:200});
    assert.equal(JSON.stringify(logged).includes('secret provider detail'),false);
  }finally{console.error=original;}
});

test('read-only HTTP failure falls back, while broadcasts never retry or fall back',async()=>{
  const urls:string[]=[];const upstream=(async(url)=>{urls.push(String(url));return urls.length===1
    ?new Response('',{status:429}):Response.json({jsonrpc:'2.0',id:1,result:'0x01'});}) as typeof fetch;
  await chainTransport('key123',upstream)(CHAIN.rpc,{method:'POST',body:readBody});
  assert.deepEqual(urls,['https://robinhood-mainnet.g.alchemy.com/v2/key123',CHAIN.rpc]);
  urls.length=0;
  await chainTransport('key123',upstream)(CHAIN.rpc,{method:'POST',body:JSON.stringify({method:'eth_sendRawTransaction',params:['0x123']})});
  assert.deepEqual(urls,['https://robinhood-mainnet.g.alchemy.com/v2/key123']);
});

test('historical state never falls back and Worker subrequest limits never retry',async()=>{
  const urls:string[]=[];
  const upstream=(async(url)=>{urls.push(String(url));throw Error('Too many subrequests.');}) as typeof fetch;
  await assert.rejects(chainTransport('key123',upstream)(CHAIN.rpc,{method:'POST',body:readBody}),/read limit/);
  assert.equal(urls.length,1);
  urls.length=0;
  const historical=readBody.replace('"latest"','"0x123"');
  const failed=(async(url)=>{urls.push(String(url));return Response.json({error:{code:-32005}});}) as typeof fetch;
  await chainTransport('key123',failed)(CHAIN.rpc,{method:'POST',body:historical});
  assert.deepEqual(urls,['https://robinhood-mainnet.g.alchemy.com/v2/key123']);
});
