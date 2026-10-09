import {buildAccountingEvidence,type AccountingSources,type ObservedBalance,type ObservedTransfer} from './live-accounting.ts';
import {fetchPracticeMarketQuote} from './practice-market.ts';
import {mandateDigest,type PolicyLease,type MandateSnapshot} from './policy-lease.ts';
import {CHAIN} from './robinhood-chain.ts';
import type {SpendEvidence} from '../db/execution-attempts.ts';
import type {Mandate} from './decision.ts';

// Production wiring for the live dollar-accounting evidence and the spending-grant gate.
// Everything here is read-only and fail-closed: a missing source becomes a named gap and a
// false coverage flag, never a zero. No signer, submission route or grant installer calls
// these helpers to spend; they produce the evidence an activation would have to satisfy.
export type LiveAccountingSection={executionEnabled:false;assembled:boolean;gaps:string[];ledgerSource:'owner-ledger'|'unavailable';
  targets:{symbol:string;gaps:string[];portfolioTotalMicroUsd:string|null;positionMicroUsd:string|null;externalBuysTodayCents:number}[]};
export type GrantGateSection={executionEnabled:false;activeGrants:number;driftedGrants:number;why:string};

// Alchemy-backed read-only sources for buildAccountingEvidence. `rpc` is the keyed chain
// transport; `web` is plain fetch for the named price feeds. Both injectable for tests.
export function alchemyAccountingSources(rpc:typeof fetch,web:typeof fetch):AccountingSources{
 const chain=async(method:string,params:unknown[])=>{
  const response=await rpc(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('RPC unavailable');
  const body=await response.json() as {result?:unknown;error?:unknown};
  if(body.error||!Object.hasOwn(body,'result'))throw Error('RPC rejected');
  return body.result;
 };
 return {
  block:async()=>{
   const number=await chain('eth_blockNumber',[]).catch(()=>null);
   const header=number?await chain('eth_getBlockByNumber',[number,false]).catch(()=>null):null;
   return typeof header==='object'&&header&&typeof (header as{hash?:unknown}).hash==='string'?{hash:(header as{hash:string}).hash,observedAt:new Date().toISOString()}:null;
  },
  balances:async(address)=>{
   const native=await chain('eth_getBalance',[address,'latest']).catch(()=>null);
   const list=await chain('alchemy_getTokenBalances',[address,'erc20']).catch(()=>null);
   if(typeof native!=='string'||!Array.isArray((list as{tokenBalances?:unknown[]})?.tokenBalances))return null;
   const balances=(list as{tokenBalances:{contractAddress:string;tokenBalance:string;error?:unknown}[]}).tokenBalances;
   if(balances.length>30)return null;
   const rows:ObservedBalance[]=[{symbol:'ETH',token:'0x'+'0'.repeat(40),raw:BigInt(native).toString(),decimals:18}];
   for(const entry of balances){
    if(entry.error||!/^0x[0-9a-f]*$/i.test(String(entry.tokenBalance??'')))return null;
    const raw=BigInt(entry.tokenBalance).toString();if(raw==='0')continue;
    const meta=await chain('alchemy_getTokenMetadata',[entry.contractAddress]).catch(()=>null) as{symbol?:unknown;decimals?:unknown}|null;
    if(!meta||typeof meta.symbol!=='string'||typeof meta.decimals!=='number'||!Number.isInteger(meta.decimals)||meta.decimals<0||meta.decimals>18)return null;
    rows.push({symbol:meta.symbol.toUpperCase().slice(0,8),token:String(entry.contractAddress).toLowerCase(),raw,decimals:meta.decimals});
   }
   return rows;
  },
  transfers:async(address)=>{
   const items:ObservedTransfer[]=[];
   for(const direction of ['fromAddress','toAddress']){
    let pageKey:unknown=undefined,pages=0;
    do{
     const body:{category:string[];withMetadata:boolean;maxCount:string;fromBlock:string;pageKey?:unknown;fromAddress?:string;toAddress?:string}={category:['external','erc20'],withMetadata:true,maxCount:'0x3e8',fromBlock:'0x0'};
     body[direction as'fromAddress'|'toAddress']=address;if(pageKey)body.pageKey=pageKey;
     const page=await chain('alchemy_getAssetTransfers',[body]).catch(()=>null) as{transfers?:unknown[];pageKey?:unknown}|null;
     if(!page||!Array.isArray(page.transfers))return null;
     for(const t of page.transfers as{hash?:string;from?:string;to?:string;asset?:string;value?:number;rawContract?:{value?:string|null;decimal?:string|null;address?:string|null};metadata?:{blockTimestamp?:string}}[]){
      let raw:string|null=null,decimals:number|null=null;
      if(t.rawContract?.value&&t.rawContract?.decimal){raw=BigInt(t.rawContract.value).toString();decimals=parseInt(t.rawContract.decimal,16);}
      else if(t.asset==='ETH'){const tx=await chain('eth_getTransactionByHash',[t.hash]).catch(()=>null) as{value?:string}|null;if(tx?.value){raw=BigInt(tx.value).toString();decimals=18;}}
      if(!raw||decimals===null||decimals<0||decimals>18||!t.hash||!/^0x[0-9a-f]{64}$/i.test(t.hash)||!t.from||!t.to)return null;
      items.push({hash:t.hash.toLowerCase(),from:t.from.toLowerCase(),to:t.to.toLowerCase(),symbol:(t.asset??'UNKNOWN').toUpperCase().slice(0,8),token:String(t.rawContract?.address??'0x'+'0'.repeat(40)).toLowerCase(),raw,decimals,day:t.metadata?.blockTimestamp?new Date(t.metadata.blockTimestamp).toISOString().slice(0,10):''});
     }
     pageKey=page.pageKey;pages++;
    }while(pageKey&&pages<25);
    if(pageKey)return null;
   }
   const seen=new Set<string>();
   return {items:items.filter(t=>{const k=`${t.hash}|${t.from}|${t.to}|${t.token}|${t.raw}`;if(seen.has(k))return false;seen.add(k);return true;}),complete:true};
  },
  priceBound:async(symbol)=>{
   try{
    if(symbol==='USDG'){
     const r=await web('https://api.coingecko.com/api/v3/simple/price?ids=global-dollar&vs_currencies=usd&include_last_updated_at=true',{signal:AbortSignal.timeout(10000)});
     if(!r.ok)return null;
     const g=(await r.json() as Record<string,{usd?:number;last_updated_at?:number}>)['global-dollar'];
     const spot=Number(g?.usd);
     if(!Number.isFinite(spot)||spot<=0||Math.abs(Date.now()/1000-Number(g?.last_updated_at))>600)return null;
     return {upperMicroUsd:String(Math.ceil(spot*1.005*1e6)),lowerMicroUsd:String(Math.floor(spot*0.995*1e6)),priceAt:new Date().toISOString(),source:'CoinGecko global-dollar spot with a +/-0.5% bound band'};
    }
    if(symbol==='ETH'){
     const r=await web('https://api.binance.com/api/v3/ticker/24hr?symbol=ETHUSDT',{signal:AbortSignal.timeout(10000)});
     if(!r.ok)return null;
     const t=await r.json() as{bidPrice?:string;askPrice?:string};
     const bid=Number(t?.bidPrice),ask=Number(t?.askPrice);
     if(!(bid>0)||ask<bid)return null;
     return {upperMicroUsd:String(Math.ceil(ask*1e6)),lowerMicroUsd:String(Math.floor(bid*1e6)),priceAt:new Date().toISOString(),source:'Binance ETHUSDT bid/ask; USDT stands in for USD'};
    }
    const quote=await fetchPracticeMarketQuote(symbol,Date.now(),web);
    if(!quote?.bidCents||!quote.askCents)return null;
    return {upperMicroUsd:String(quote.askCents*10000),lowerMicroUsd:String(quote.bidCents*10000),priceAt:new Date(quote.generatedAt).toISOString(),source:quote.source+' bid/ask bound'};
   }catch{return null;}
  },
 };
}

// Readiness-side dollar evidence for every allowed symbol (cap six, the policy maximum).
// There is no buy proposal here, so no dollar conclusion is claimed: this reports whether
// the complete evidence assembles and which gaps keep it from passing.
export async function liveAccountingSection(address:string,mandate:Mandate|null,ledger:SpendEvidence|null,sources:AccountingSources,now=Date.now()):Promise<LiveAccountingSection>{
 const gaps:string[]=[];
 if(!mandate||!Array.isArray(mandate.allowedSymbols)||mandate.allowedSymbols.length===0)gaps.push('Saved mandate with allowed symbols is required for dollar accounting.');
 if(!ledger)gaps.push('Owner spend ledger evidence is unavailable; unresolved reservations cannot be valued.');
 const ledgerSource=ledger?'owner-ledger':'unavailable';
 if(gaps.length)return {executionEnabled:false,assembled:false,gaps,ledgerSource,targets:[]};
 // Fee + slippage margin at 3% of the order ceiling, in micro-USD (cents -> micro-USD is 10^4).
 const lossMarginMicroUsd=String(Math.max(1,Math.round(mandate!.maxOrderCents*300)));
 const targets:LiveAccountingSection['targets']=[];
 for(const symbol of mandate!.allowedSymbols.slice(0,6)){
  const assembly=await buildAccountingEvidence(address,symbol,lossMarginMicroUsd,ledger!,sources,now);
  targets.push({symbol,gaps:assembly.gaps,
   portfolioTotalMicroUsd:assembly.evidence?assembly.evidence.portfolio.totalMicroUsd:null,
   positionMicroUsd:assembly.evidence?assembly.evidence.portfolio.positionMicroUsd:null,
   externalBuysTodayCents:assembly.externalBuysTodayCents});
 }
 return {executionEnabled:false,assembled:targets.every(t=>t.gaps.length===0),gaps,ledgerSource,targets};
}

// Spending-grant lifecycle gate. Reads lease state only; today no lease store or installer
// exists, so callers pass the empty list and the gate reports that honestly. A future
// installer must call installablePolicyLease before any paid installation.
export function grantGateSection(leases:PolicyLease[],observedMandate:MandateSnapshot|null,now=Date.now()):GrantGateSection{
 const active=leases.filter(l=>l.state==='active');
 let drifted=0;
 if(observedMandate){for(const lease of active){
  let digest:string|null=null;try{digest=mandateDigest(observedMandate);}catch{digest=null;}
  if(!digest||lease.mandateDigest.toLowerCase()!==digest.toLowerCase()||lease.mandateVersion!==observedMandate.version)drifted++;
 }}
 const why=active.length===0
  ?'No spending grant is installed. Installation stays blocked until an owner-signed policy lease passes installablePolicyLease.'
  :drifted>0
   ?`${drifted} active grant(s) are bound to a mandate that has since changed; revoke them before any replacement.`
   :'Active grant(s) match the saved mandate. Owner-controlled revocation remains the only removal path.';
 return {executionEnabled:false,activeGrants:active.length,driftedGrants:drifted,why};
}
