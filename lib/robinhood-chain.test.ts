import test from "node:test";
import assert from "node:assert/strict";
import { units, registry, readChain } from "./robinhood-chain.ts";
test("exact amounts retain huge and tiny values", () => {
  assert.equal(units("0x1",18),"0.000000000000000001");
  assert.equal(units("0x20000000000001",0),"9007199254740993");
  assert.throws(()=>units("0x1",99));
});
test("reader verifies chain, pins reads, and records failed balances as incomplete",async()=>{
  const address="0x1111111111111111111111111111111111111111";
  const mock=(wrong=false):typeof fetch=>(async(input,init)=>{
    if(String(input).endsWith("/assets"))return Response.json({assets:[{tokenSymbol:"AAPL",deployments:[{chainId:4663,contractAddress:address}]}]});
    const calls=JSON.parse(String(init?.body)) as {id:number;method:string;params:unknown[]}[];
    return Response.json(calls.map(c=>{
      if(c.method==="eth_chainId")return {id:c.id,result:wrong?"0x1":"0x1237"};
      if(c.method==="eth_blockNumber")return {id:c.id,result:"0x42"};
      assert.equal(c.params[1],"0x42");
      if(c.method==="eth_getBalance")return {id:c.id,result:"0x0"};
      assert.equal(c.method,"eth_call");
      return {id:c.id,error:{message:"read failed"}};
    }).reverse());
  }) as typeof fetch;
  const r=await readChain(address,mock());assert.equal(r.failures,1);assert.equal(r.holdings.length,0);
  await assert.rejects(readChain(address,mock(true)),/identity/);
});
test("empty registry and counterfeit addresses fail closed",()=>{
  assert.throws(()=>registry({assets:[]}));
  assert.throws(()=>registry({assets:[{tokenSymbol:"AAPL",deployments:[{chainId:4663,contractAddress:"fake"}]}]}));
});
