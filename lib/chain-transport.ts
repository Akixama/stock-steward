import {CHAIN, registry} from './robinhood-chain.ts';

const readMethods=new Set(['eth_call','eth_getCode','eth_getStorageAt','eth_getBalance','eth_getTransactionByHash',
  'eth_getTransactionReceipt','eth_getBlockByNumber','eth_blockNumber','eth_chainId','eth_gasPrice',
  'eth_estimateGas','eth_getLogs','eth_feeHistory','eth_getTransactionCount']);
function rpcMethods(body:BodyInit|null|undefined):string[]{
  if(typeof body!=='string')return [];
  try{const request=JSON.parse(body) as {method?:unknown}|{method?:unknown}[];
    return (Array.isArray(request)?request:[request]).map(item=>typeof item.method==='string'?item.method:'');
  }catch{return [];}
}

// Server callers supply the secret. This module never reads or returns it to a browser.
export function chainTransport(apiKey?:string, upstream:typeof fetch=fetch):typeof fetch {
  if(apiKey && !/^[A-Za-z0-9_-]+$/.test(apiKey))throw new Error('Invalid RPC configuration');
  return (async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    const rpc=url===CHAIN.rpc;
    const target=rpc&&apiKey?`https://robinhood-mainnet.g.alchemy.com/v2/${apiKey}`:input;
    const methods=rpc?rpcMethods(init?.body):[];
    const readOnly=methods.length>0&&methods.every(method=>readMethods.has(method));
    const sends=methods.some(method=>method==='eth_sendRawTransaction'||method==='eth_sendTransaction');
    // Historical contract state must come from the archive provider. A public
    // latest-state fallback is safe for display reads, never for proof at a block.
    let historicalState=false;
    if(rpc&&typeof init?.body==='string')try{
      const requests=JSON.parse(init.body) as {method?:string;params?:unknown[]} | {method?:string;params?:unknown[]}[];
      historicalState=(Array.isArray(requests)?requests:[requests]).some(request=>
        ['eth_call','eth_getCode','eth_getStorageAt'].includes(request.method??'') &&
        request.params?.at(-1)!=='latest');
    }catch{/* Invalid requests never qualify for fallback. */historicalState=true;}
    const canFallback=Boolean(rpc&&apiKey&&readOnly&&!historicalState);
    // Broadcasts always get one attempt on the configured provider.
    const attempts=sends?1:readOnly?2:init?.signal?1:2;
    let lastResponse:Response|undefined;
    for(let attempt=1;attempt<=attempts;attempt++){
      try {
        const response=await upstream(target,init?.signal
          ? {...init,redirect:'manual'}
          : {...init,redirect:'manual',signal:AbortSignal.timeout(15000)});
        lastResponse=response;
        if(!response.ok)console.error('chain_dependency_http',{service:rpc?'rpc':'registry',provider:rpc&&apiKey?'alchemy':'public',method:methods.join(','),status:response.status});
        if(!response.ok&&canFallback){
          try{
            const body=await response.clone().json() as {error?:{code?:unknown}};
            if(body?.error){const code=typeof body.error.code==='number'&&Number.isSafeInteger(body.error.code)?body.error.code:'unknown';
              console.error('chain_dependency_rpc_error',{provider:'alchemy',method:methods.join(','),code,status:response.status});}
          }catch{/* HTTP status and method are already recorded. */}
          break;
        }
        if(rpc&&readOnly&&typeof response.clone==='function'){
          let body:unknown;
          try{body=JSON.parse(await response.clone().text());}catch{
            console.error('chain_dependency_invalid_json',{service:'rpc',provider:apiKey?'alchemy':'public',method:methods.join(',')});
            if(attempt<attempts&&!init?.signal?.aborted){await new Promise(resolve=>setTimeout(resolve,300));continue;}
            if(!canFallback)throw new Error('Chain read returned an incomplete response. Retry later.');
            break;
          }
          const entries=Array.isArray(body)?body:[body];
          const failed=entries.find(entry=>entry&&typeof entry==='object'&&'error' in entry) as {error?:{code?:unknown}}|undefined;
          if(failed){
            const code=typeof failed.error?.code==='number'&&Number.isSafeInteger(failed.error.code)?failed.error.code:'unknown';
            console.error('chain_dependency_rpc_error',{provider:apiKey?'alchemy':'public',method:methods.join(','),code,status:response.status});
            if(canFallback)break;
          }
          if(!failed&&entries.length===1&&(!entries[0]||typeof entries[0]!=='object'||!('result' in entries[0]))){
            console.error('chain_dependency_rpc_error',{provider:apiKey?'alchemy':'public',method:methods.join(','),code:'missing_result',status:response.status});
            if(canFallback)break;
          }
        }
        if(!response.ok&&canFallback)break;
        return response;
      }catch(error){
        const message=error instanceof Error?error.message:'Unknown transport exception';
        const detail=message.replaceAll(apiKey??'__no_key__','[redacted]').replace(/https?:\/\/\S+/g,'[url]').slice(0,250);
        console.error('chain_dependency_transport',{service:rpc?'rpc':'registry',provider:rpc&&apiKey?'alchemy':'public',method:methods.join(','),detail});
        if(/subrequest|too many requests|limit exceeded/i.test(message))throw new Error('Chain read limit reached. Retry later.');
        if(message==='Chain read returned an incomplete response. Retry later.')throw error;
        if(attempt<attempts&&!init?.signal)await new Promise((resolve)=>setTimeout(resolve,500));
        else if(!canFallback)throw new Error(rpc?'RPC transport unavailable':'Registry transport unavailable');
      }
    }
    if(canFallback&&!init?.signal?.aborted){
      try{
        const response=await upstream(CHAIN.rpc,{...init,redirect:'manual',signal:init?.signal??AbortSignal.timeout(15000)});
        if(!response.ok)throw new Error(`http_${response.status}`);
        const body=await response.clone().json() as {result?:unknown;error?:{code?:unknown}};
        if(body?.error||(!Array.isArray(body)&&body?.result===undefined)){
          const code=typeof body?.error?.code==='number'&&Number.isSafeInteger(body.error.code)?body.error.code:'unknown';
          console.error('chain_dependency_rpc_error',{provider:'public',method:methods.join(','),code,status:response.status});
          throw new Error('Public RPC read failed');
        }
        console.warn('chain_dependency_fallback',{method:methods.join(',')});
        return response;
      }catch(error){
        const message=error instanceof Error?error.message:'';
        if(/subrequest|too many requests|limit exceeded/i.test(message))throw new Error('Chain read limit reached. Retry later.');
        console.error('chain_dependency_fallback_failed',{method:methods.join(',')});
      }
    }
    if(lastResponse?.ok&&!canFallback)return lastResponse;
    throw new Error(rpc?'RPC transport unavailable':'Registry transport unavailable');
  }) as typeof fetch;
}

// Public nodes serve canonical headers/receipts, but may prune historical state.
// Keep archive reads on the configured private provider; never substitute latest
// state for transaction-block evidence.
export function receiptTransport(apiKey?:string,upstream:typeof fetch=fetch):typeof fetch {
 const archive=chainTransport(apiKey,upstream);
 return (async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(url===CHAIN.rpc&&typeof init?.body==='string'){
   const query=JSON.parse(init.body) as {method?:string};
   if(['eth_call','eth_getCode','eth_getStorageAt'].includes(query.method??''))return archive(input,init);
  }
  return upstream(input,init);
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
