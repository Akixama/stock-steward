import {CHAIN, registry} from './robinhood-chain.ts';

// Server callers supply the secret. This module never reads or returns it to a browser.
export function chainTransport(apiKey?:string, upstream:typeof fetch=fetch):typeof fetch {
  if(apiKey && !/^[A-Za-z0-9_-]+$/.test(apiKey))throw new Error('Invalid RPC configuration');
  return (async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    const rpc=url===CHAIN.rpc;
    const target=rpc&&apiKey?`https://robinhood-mainnet.g.alchemy.com/v2/${apiKey}`:input;
    try {
      const response=await upstream(target,{...init,redirect:'manual'});
      if(!response.ok)console.error('chain_dependency_http',{service:rpc?'rpc':'registry',provider:rpc&&apiKey?'alchemy':'public',status:response.status});
      return response;
    }catch(error){
      const message=error instanceof Error?error.message:'Unknown transport exception';
      const detail=message.replaceAll(apiKey??'__no_key__','[redacted]').replace(/https?:\/\/\S+/g,'[url]').slice(0,250);
      console.error('chain_dependency_transport',{service:rpc?'rpc':'registry',provider:rpc&&apiKey?'alchemy':'public',detail});
      throw new Error(rpc?'RPC transport unavailable':'Registry transport unavailable');
    }
  }) as typeof fetch;
}

export async function chainHealth(fetcher:typeof fetch=fetch){
  const result:{rpc:string;registry:string;block?:string;assets?:number}={rpc:'unavailable',registry:'unavailable'};
  await Promise.all([
    (async()=>{try{const r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]},{jsonrpc:'2.0',id:2,method:'eth_blockNumber',params:[]}]),signal:AbortSignal.timeout(10000)});if(!r.ok){result.rpc=`http_${r.status}`;return;}const b=await r.json() as {id:number;result?:string}[];if(!Array.isArray(b)){result.rpc='invalid_response';return;}if(b.find(x=>x.id===1)?.result!==CHAIN.hex){result.rpc='wrong_network';return;}const block=b.find(x=>x.id===2)?.result;if(!block||!/^0x[0-9a-f]+$/i.test(block)){result.rpc='invalid_block';return;}result.rpc='available';result.block=block;}catch{/* No provider URLs or response bodies in health output. */}})(),
    (async()=>{try{const r=await fetcher('https://api.robinhood.com/rhj/assets',{signal:AbortSignal.timeout(10000)});if(!r.ok){result.registry=`http_${r.status}`;return;}result.assets=registry(await r.json()).length;result.registry='available';}catch{/* Registry unavailable is not zero coverage. */}})(),
  ]);
  return result;
}
