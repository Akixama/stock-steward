import assert from 'node:assert/strict';
import test from 'node:test';
import {chainReadBatch} from './chain-read-batch.ts';

test('independent chain reads share one HTTP subrequest and remain matched by id',async()=>{
  let requests=0;
  const transport=async(_url:RequestInfo|URL,init?:RequestInit)=>{
    requests++;
    const sent=JSON.parse(String(init?.body)) as {id:number;method:string}[];
    assert.deepEqual(sent.map(row=>row.method),['eth_getCode','eth_call']);
    return Response.json([{jsonrpc:'2.0',id:2,result:'0x02'},{jsonrpc:'2.0',id:1,result:'0x01'}]);
  };
  assert.deepEqual(await chainReadBatch('https://rpc.example',[
    {method:'eth_getCode',params:['0xabc','latest']},{method:'eth_call',params:[{},'latest']}
  ],transport as typeof fetch),['0x01','0x02']);
  assert.equal(requests,1);
});

test('missing or failed batch proof fails closed',async()=>{
  const transport=async()=>Response.json([{jsonrpc:'2.0',id:1,result:'0x01'},{jsonrpc:'2.0',id:2,error:{code:429}}]);
  await assert.rejects(chainReadBatch('https://rpc.example',[
    {method:'eth_getCode',params:[]},{method:'eth_call',params:[]}
  ],transport as typeof fetch),/Chain read unavailable/);
});
