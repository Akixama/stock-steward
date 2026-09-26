import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chainTransport,chainHealth} from './chain-transport.ts';
import {CHAIN} from './robinhood-chain.ts';
test('private RPC configuration affects RPC only; registry receives no credential',async()=>{
 const calls:string[]=[];const f=chainTransport('private-test-key',(async(url,init)=>{calls.push(String(url));assert.equal(init?.redirect,'error');return Response.json({});}) as typeof fetch);
 await f(CHAIN.rpc);await f('https://api.robinhood.com/rhj/assets');
 assert.deepEqual(calls,['https://robinhood-mainnet.g.alchemy.com/v2/private-test-key','https://api.robinhood.com/rhj/assets']);
});
test('upstream exception never exposes a credential',async()=>{
 const f=chainTransport('private-test-key',(async()=>{throw Error('https://provider/private-test-key');}) as typeof fetch);
 await assert.rejects(f(CHAIN.rpc),/^Error: RPC transport unavailable$/);
});
test('health distinguishes HTTP failure from wrong network and unavailable registry',async()=>{
 const bad=await chainHealth((async(url)=>String(url)===CHAIN.rpc?new Response('',{status:403}):Response.json({assets:[]})) as typeof fetch);
 assert.equal(bad.rpc,'http_403');assert.equal(bad.registry,'unavailable');assert.equal(bad.assets,undefined);
 const wrong=await chainHealth((async()=>Response.json([{id:1,result:'0x1'},{id:2,result:'0x42'}])) as typeof fetch);
 assert.equal(wrong.rpc,'wrong_network');assert.equal(wrong.block,undefined);
});
