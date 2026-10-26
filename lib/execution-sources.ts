import {CHAIN,USDG,registry,type ChainHolding} from './robinhood-chain.ts';
import {decimal18,priceEvidence} from './chain-analysis.ts';
import {isMemecoin} from './memecoin-list.ts';
import {memecoinPriceBound} from './memecoin-price.ts';
import type {AccountingSources,ObservedBalance,ObservedTransfer,PriceBound} from './live-accounting.ts';
export type ExecutionAnchor={number:string;hash:string;timestamp:string;observedAt:string};
export type ExecutionSources=AccountingSources & {verifyCanonical():Promise<boolean>;tokenDecimals(token:string):Promise<number|null>};
type Header={number:string;hash:string;timestamp:string};
type Log={address:string;topics:string[];data:string;transactionHash:string;blockHash:string;blockNumber:string;logIndex:string;removed?:boolean};
const ZERO='0x'+'0'.repeat(40),TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const hex=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]+$/i.test(v);
const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{40}$/i.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
const same=(a:string,b:string)=>a?.toLowerCase()===b?.toLowerCase();
const word=(a:string)=>'0x'+a.slice(2).toLowerCase().padStart(64,'0');
const addressTopic=(v:unknown):v is string=>typeof v==='string'&&/^0x0{24}[0-9a-f]{40}$/i.test(v);
const S=10n**18n;
// Each instance is tied to one route block. Discovery/indexer amounts and
// token symbols never establish balances or identity; canonical RPC does.
export async function executionAccountingSources(anchor:ExecutionAnchor,rpc:typeof fetch=fetch,web:typeof fetch=fetch,now=Date.now(),requestedSymbols:string[]=[]):Promise<ExecutionSources> {
 const startedAt=Date.now(),clock=()=>now+Date.now()-startedAt;
 if(!hex(anchor.number)||!hash(anchor.hash)||!hex(anchor.timestamp)||!Number.isFinite(Date.parse(anchor.observedAt))||now-Date.parse(anchor.observedAt)<0||now-Date.parse(anchor.observedAt)>30000||now-Number(BigInt(anchor.timestamp))*1000<0||now-Number(BigInt(anchor.timestamp))*1000>30000)throw Error('Fresh route block is required.');
 if(new Date(Number(BigInt(anchor.timestamp))*1000).toISOString().slice(0,10)!==new Date(now).toISOString().slice(0,10))throw Error('Refresh the route after the UTC budget day changes.');
 let serial=0;
 async function batch(calls:{method:string;params:unknown[]}[]){
  if(!calls.length)return [];
  const payload=calls.map(call=>({...call,jsonrpc:'2.0',id:++serial}));
  const r=await rpc(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),cache:'no-store'});
  const body=await r.json() as {id:number;result?:unknown;error?:unknown}[];
  if(!r.ok||!Array.isArray(body)||body.length!==payload.length||new Set(body.map(row=>row.id)).size!==body.length)throw Error('Incomplete RPC batch.');
  return payload.map(call=>{const row=body.find(value=>value.id===call.id);if(!row||row.error||!Object.hasOwn(row,'result'))throw Error('RPC evidence unavailable.');return row.result;});
 }
 async function chain(method:string,params:unknown[]){return (await batch([{method,params}]))[0];}
 const [network,header]=await batch([{method:'eth_chainId',params:[]},{method:'eth_getBlockByNumber',params:[anchor.number,false]}]);
 const h=header as Header;
 if(network!==CHAIN.hex||h?.number!==anchor.number||!same(h.hash,anchor.hash)||h.timestamp!==anchor.timestamp)throw Error('Route block or network changed.');
 const response=await web('https://api.robinhood.com/rhj/assets',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Official registry unavailable.');
 const assets=registry(await response.json());const byToken=new Map(assets.map(asset=>[asset.contract.toLowerCase(),asset]));
 if(new Set(assets.map(asset=>asset.symbol)).size!==assets.length)throw Error('Ambiguous asset symbols.');
 if(requestedSymbols.length>6||new Set(requestedSymbols).size!==requestedSymbols.length||requestedSymbols.some(symbol=>!assets.some(a=>a.symbol===symbol)))throw Error('Unrecognized strategy target.');
 const metadata=new Map<string,{symbol:string;decimals:number}>();metadata.set(USDG.contract.toLowerCase(),{symbol:'USDG',decimals:USDG.decimals});metadata.set(ZERO,{symbol:'ETH',decimals:18});
 const prices=new Map<string,Promise<PriceBound|null>>();const receipts=new Map<string,Promise<{logs:Log[];blockNumber:string;blockHash:string;transactionHash:string}>>();
 async function tokenMetadata(token:string){
  token=token.toLowerCase();const cached=metadata.get(token);if(cached)return cached;
  const asset=byToken.get(token);if(!asset||asset.status!=='ASSET_STATUS_ACTIVE'||asset.pendingMultiplier)throw Error('Unrecognized or changing held token.');
  const raw=await chain('eth_call',[{to:token,data:'0x313ce567'},anchor.number]);
  if(!hash(raw)||BigInt(raw)>18n)throw Error('Token decimals unavailable.');const result={symbol:asset.symbol,decimals:Number(BigInt(raw))};metadata.set(token,result);return result;
 }
 async function price(symbol:string):Promise<PriceBound|null>{
  try{
   if(symbol==='USDG'){
    const r=await web('https://api.coingecko.com/api/v3/simple/price?ids=global-dollar&vs_currencies=usd&include_last_updated_at=true',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)return null;
    const g=(await r.json() as Record<string,{usd:number;last_updated_at:number}>)['global-dollar'];
    if(!g||!Number.isFinite(g.usd)||g.usd<=0||!Number.isSafeInteger(g.last_updated_at))return null;
    const at=g.last_updated_at*1000;if(clock()-at<0||clock()-at>30000)return null;
    return {upperMicroUsd:String(Math.ceil(g.usd*1.005*1e6)),lowerMicroUsd:String(Math.floor(g.usd*0.995*1e6)),priceAt:new Date(at).toISOString(),source:'CoinGecko timestamped USDG/USD with conservative 0.5% band'};
   }
   if(symbol==='ETH'){
    const r=await web('https://api.exchange.coinbase.com/products/ETH-USD/ticker',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)return null;
    const quote=await r.json() as {bid:string;ask:string;time:string};const at=Date.parse(quote.time),bid=decimal18(quote.bid),ask=decimal18(quote.ask);
    if(!Number.isFinite(at)||clock()-at<0||clock()-at>30000||bid<=0n||ask<bid)return null;
    return {upperMicroUsd:((ask*1000000n+S-1n)/S).toString(),lowerMicroUsd:(bid*1000000n/S).toString(),priceAt:quote.time,source:'Coinbase ETH-USD timestamped bid/ask (not USDT)'};
   }
   // Memecoins: quoted at this same anchored block from their own USDG pool.
   if(isMemecoin(symbol)){if(!assets.some(row=>row.symbol===symbol))return null;return memecoinPriceBound(symbol,(to,data)=>chain('eth_call',[{to,data},anchor.number]),clock());}
   const asset=assets.find(row=>row.symbol===symbol);if(!asset)return null;const r=await web(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(symbol)}`,{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)return null;
   const holding:ChainHolding={symbol,contract:asset.contract,raw:'0',decimals:18,quantity:'0',status:asset.status,multiplier:asset.multiplier,pendingMultiplier:asset.pendingMultiplier};
   const proof=priceEvidence(holding,await r.json(),clock());const at=Date.parse(proof.generatedAt??'');if(proof.state!=='fresh'||!proof.bid||!proof.ask||!proof.multiplier||!Number.isFinite(at)||clock()-at<0||clock()-at>30000)return null;
   const multiplier=decimal18(proof.multiplier),bid=decimal18(proof.bid)*multiplier,ask=decimal18(proof.ask)*multiplier,scale=S*S;
   return {shareUpperMicroUsd:((decimal18(proof.ask)*1000000n+S-1n)/S).toString(),shareLowerMicroUsd:(decimal18(proof.bid)*1000000n/S).toString(),upperMicroUsd:((ask*1000000n+scale-1n)/scale).toString(),lowerMicroUsd:(bid*1000000n/scale).toString(),priceAt:proof.generatedAt!,source:'Official matching stock deployment bid/ask × current shares-per-token multiplier'};
  }catch{return null;}
 }
 async function verifyCanonical(){try{const current=await chain('eth_getBlockByNumber',[anchor.number,false]) as Header;return current?.number===anchor.number&&same(current.hash,anchor.hash)&&current.timestamp===anchor.timestamp;}catch{return false;}}
 async function receipt(txHash:string){let task=receipts.get(txHash);if(!task){if(receipts.size>=50)throw Error('History exceeds synchronous verification limit.');task=(async()=>{const r=await chain('eth_getTransactionReceipt',[txHash]) as {logs:Log[];blockNumber:string;blockHash:string;transactionHash:string};if(!r||!same(r.transactionHash,txHash)||!hex(r.blockNumber)||BigInt(r.blockNumber)>BigInt(anchor.number)||!hash(r.blockHash)||!Array.isArray(r.logs))throw Error('Incomplete receipt.');const header=await chain('eth_getBlockByNumber',[r.blockNumber,false]) as Header;if(!same(header?.hash,r.blockHash))throw Error('Noncanonical history.');return r;})();receipts.set(txHash,task);}return task;}
 const sources:ExecutionSources={
  verifyCanonical,
  verifiedStock:async(token,symbol,decimals)=>{try{if(!address(token)||!byToken.has(token.toLowerCase()))return false;const meta=await tokenMetadata(token);return meta.symbol===symbol&&meta.decimals===decimals;}catch{return false;}},
  tokenDecimals:async(token)=>{try{if(!address(token))return null;return (await tokenMetadata(token)).decimals;}catch{return null;}},
  block:async()=>await verifyCanonical()?{hash:anchor.hash,observedAt:anchor.observedAt}:null,
  balances:async(account)=>{
   if(!address(account))return null;
   try{
    const discovered=new Set<string>([USDG.contract.toLowerCase(),...byToken.keys()]);const pages=new Set<string>();let pageKey:string|undefined;
    for(let page=0;page<10;page++){
     const list=await chain('alchemy_getTokenBalances',[account,'erc20',{maxCount:100,...(pageKey?{pageKey}:{})}]) as {address:string;tokenBalances:{contractAddress:string;error?:unknown}[];pageKey?:string};
     if(!list||!same(list.address,account)||!Array.isArray(list.tokenBalances)||list.tokenBalances.length>100)throw Error('Incomplete discovery.');
     for(const row of list.tokenBalances){if(!address(row.contractAddress)||row.error)throw Error('Invalid discovery.');discovered.add(row.contractAddress.toLowerCase());}
     if(!list.pageKey){pageKey=undefined;break;}if(typeof list.pageKey!=='string'||pages.has(list.pageKey))throw Error('Discovery pagination stalled.');pages.add(list.pageKey);pageKey=list.pageKey;
    }
    if(pageKey||discovered.size>600)throw Error('Discovery coverage incomplete.');
    const tokens=[...discovered],native=await chain('eth_getBalance',[account,anchor.number]);if(!hex(native))throw Error('Native balance unavailable.');
    const rows:ObservedBalance[]=[{symbol:'ETH',token:ZERO,raw:BigInt(native).toString(),decimals:18}];
    for(let start=0;start<tokens.length;start+=80){const slice=tokens.slice(start,start+80);const results=await batch(slice.map(token=>({method:'eth_call',params:[{to:token,data:'0x70a08231'+account.slice(2).toLowerCase().padStart(64,'0')},anchor.number]})));for(let i=0;i<slice.length;i++){const raw=results[i];if(!hash(raw))throw Error('Pinned token balance unavailable.');if(BigInt(raw)===0n&&!requestedSymbols.includes(byToken.get(slice[i])?.symbol??''))continue;const meta=await tokenMetadata(slice[i]);rows.push({token:slice[i],raw:BigInt(raw).toString(),...meta});if(rows.length>31)throw Error('Inventory valuation limit exceeded.');}}
    // An explicit zero settlement row keeps token identity/decimals bound.
    if(!rows.some(row=>same(row.token,USDG.contract)))rows.push({symbol:'USDG',token:USDG.contract.toLowerCase(),raw:'0',decimals:6});
    if(!await verifyCanonical())throw Error('Block changed.');return rows;
   }catch{return null;}
  },
  transfers:async(account)=>{
   if(!address(account))return null;
   try{
    const txHashes=new Set<string>(),dailyLogs=new Map<string,Log>();
    for(const direction of ['fromAddress','toAddress']){let pageKey:string|undefined;const seen=new Set<string>();for(let page=0;page<10;page++){
     const data=await chain('alchemy_getAssetTransfers',[{fromBlock:'0x0',toBlock:anchor.number,[direction]:account,category:['external','erc20'],withMetadata:true,maxCount:'0x3e8',...(pageKey?{pageKey}:{})}]) as {transfers:{hash:string}[];pageKey?:string};
     if(!data||!Array.isArray(data.transfers)||data.transfers.length>1000)throw Error('Incomplete indexed history.');for(const row of data.transfers){if(!hash(row.hash))throw Error('Invalid history.');txHashes.add(row.hash.toLowerCase());}if(txHashes.size>50)throw Error('History exceeds synchronous verification limit.');
     if(!data.pageKey){pageKey=undefined;break;}if(typeof data.pageKey!=='string'||seen.has(data.pageKey))throw Error('History pagination stalled.');seen.add(data.pageKey);pageKey=data.pageKey;
    }if(pageKey)throw Error('History coverage incomplete.');}
    // Independently cover today's ERC-20 logs, including transactions the
    // enhanced indexer has not seen yet. Exact topics/amounts come from receipts.
    const midnight=BigInt(Math.floor(now/86400000)*86400);let lo=0n,hi=BigInt(anchor.number);
    while(lo<hi){const mid=(lo+hi)/2n;const header=await chain('eth_getBlockByNumber',['0x'+mid.toString(16),false]) as Header;if(!header||!hex(header.timestamp))throw Error('Daily history boundary unavailable.');if(BigInt(header.timestamp)<midnight)lo=mid+1n;else hi=mid;}
    const calls:{method:string;params:unknown[]}[]=[];for(let from=lo;from<=BigInt(anchor.number);from+=10000n){const to=from+9999n>BigInt(anchor.number)?BigInt(anchor.number):from+9999n;for(const topics of [[TRANSFER,word(account)],[TRANSFER,null,word(account)]])calls.push({method:'eth_getLogs',params:[{fromBlock:'0x'+from.toString(16),toBlock:'0x'+to.toString(16),topics}]});}
    if(calls.length>240)throw Error('Daily log coverage limit exceeded.');
    for(let start=0;start<calls.length;start+=80){const lists=await batch(calls.slice(start,start+80));for(const list of lists){if(!Array.isArray(list)||list.length>1000)throw Error('Incomplete canonical logs.');for(const log of list as Log[]){if(log.removed||!address(log.address)||!hash(log.transactionHash)||!hash(log.blockHash)||!hex(log.logIndex)||!hash(log.data)||log.topics?.length!==3||log.topics[0].toLowerCase()!==TRANSFER||!addressTopic(log.topics[1])||!addressTopic(log.topics[2])||(!same(log.topics[1],word(account))&&!same(log.topics[2],word(account)))||!hex(log.blockNumber)||BigInt(log.blockNumber)<lo||BigInt(log.blockNumber)>BigInt(anchor.number))throw Error('Invalid daily log.');txHashes.add(log.transactionHash.toLowerCase());if(txHashes.size>50)throw Error('Daily history exceeds synchronous limit.');dailyLogs.set(log.transactionHash.toLowerCase()+':'+BigInt(log.logIndex),log);}}}
    const items:ObservedTransfer[]=[];
    for(const txHash of txHashes){const r=await receipt(txHash);const header=await chain('eth_getBlockByNumber',[r.blockNumber,false]) as Header;if(!hex(header.timestamp)||!same(header.hash,r.blockHash))throw Error('History timestamp unavailable.');const day=new Date(Number(BigInt(header.timestamp))*1000).toISOString().slice(0,10);
     const tx=await chain('eth_getTransactionByHash',[txHash]) as {hash:string;from:string;to:string;value:string;blockHash:string};if(!tx||!same(tx.hash,txHash)||!same(tx.blockHash,r.blockHash)||!hex(tx.value))throw Error('Historical transaction unavailable.');
     if(BigInt(tx.value)>0n&&(same(tx.from,account)||same(tx.to,account)))items.push({hash:txHash,from:tx.from.toLowerCase(),to:tx.to.toLowerCase(),symbol:'ETH',token:ZERO,raw:BigInt(tx.value).toString(),decimals:18,day});
     const seen=new Set<string>();for(const log of r.logs){if(log.topics?.[0]?.toLowerCase()!==TRANSFER||log.topics.length!==3)continue;const from='0x'+log.topics[1].slice(-40),to='0x'+log.topics[2].slice(-40);if(!same(from,account)&&!same(to,account))continue;if(log.removed||!addressTopic(log.topics[1])||!addressTopic(log.topics[2])||!hash(log.data)||!same(log.blockHash,r.blockHash)||!same(log.transactionHash,txHash)||!hex(log.logIndex)||seen.has(log.logIndex))throw Error('Invalid transfer receipt.');seen.add(log.logIndex);const meta=await tokenMetadata(log.address);items.push({hash:txHash,from:from.toLowerCase(),to:to.toLowerCase(),token:log.address.toLowerCase(),raw:BigInt(log.data).toString(),...meta,day});}
    }
    // Every independently indexed daily event must also exist verbatim in its
    // canonical receipt. An inconsistent log service cannot establish coverage.
    for(const log of dailyLogs.values()){const r=await receipt(log.transactionHash.toLowerCase());if(!r.logs.some(actual=>actual.logIndex===log.logIndex&&same(actual.address,log.address)&&same(actual.blockHash,log.blockHash)&&same(actual.transactionHash,log.transactionHash)&&actual.data===log.data&&JSON.stringify(actual.topics)===JSON.stringify(log.topics)))throw Error('Daily log disagrees with canonical receipt.');}
    if(!await verifyCanonical())throw Error('Block changed.');return {items,complete:true,nativeTransfersComplete:false};
   }catch{return null;}
  },
  priceBound:async(symbol)=>{let pending=prices.get(symbol);if(!pending){pending=price(symbol);prices.set(symbol,pending);}return pending;},
 };
 return sources;
}
