import {parseAbi,encodeFunctionData,decodeFunctionResult,keccak256,toHex,type Hex} from 'viem';
import {CHAIN} from './robinhood-chain.ts';
import {EXECUTION_CONTRACTS} from './autonomy.ts';
import {VENUE,type RouteEvidence} from './chain-route.ts';
import type {Mandate} from './decision.ts';
const routerAbi=parseAbi(['function poolManager() view returns (address)']);
const tokenAbi=parseAbi(['function allowance(address owner,address spender) view returns (uint256)']);
const permitAbi=parseAbi(['function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)']);
export type RoutePrerequisites={intent:{digest:string;mandateVersion:number|null;owner:string;recipient:string;router:string;inputToken:string;inputRaw:string;outputToken:string;minimumOutputRaw:string;poolId:string;deadline:string;blockHash:string};routerCodeHash:string|null;routerManager?:string|null;tokenAllowanceRaw:string|null;permitAllowanceRaw:string|null;permitExpiresAt:string|null;checks:{name:string;state:'pass'|'fail'|'pending';reason:string}[];executionEnabled:false;calldataPrepared:false};

export async function routePrerequisites(route:RouteEvidence,mandate:Mandate|null,fetcher:typeof fetch=fetch):Promise<RoutePrerequisites|null>{
 if(!route.best||!route.minimumOutputRaw||BigInt(route.minimumOutputRaw)<=0n)return null;
 const intentBase={mandateVersion:mandate?.version??null,owner:route.address,recipient:route.address,router:EXECUTION_CONTRACTS.router.toLowerCase(),inputToken:route.settlement,inputRaw:route.inputRaw,outputToken:route.token,minimumOutputRaw:route.minimumOutputRaw,poolId:route.best.poolId,deadline:route.expiresAt,blockHash:route.blockHash};
 const intent={digest:keccak256(toHex(JSON.stringify({schema:'stock-steward-intent-v1',chainId:CHAIN.id,routeId:route.id,...intentBase}))),...intentBase};
 const result:RoutePrerequisites={intent,routerCodeHash:null,routerManager:null,tokenAllowanceRaw:null,permitAllowanceRaw:null,permitExpiresAt:null,checks:[],executionEnabled:false,calldataPrepared:false};
 let serial=0;
 async function rpc(method:string,params:unknown[]){const id=++serial;const r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(10000),cache:'no-store'});if(!r.ok)throw Error('Prerequisite RPC unavailable');const b=await r.json() as {id:number;result?:Hex;error?:unknown};if(b.id!==id||b.error||typeof b.result!=='string'||!/^0x(?:[0-9a-f]{2})*$/i.test(b.result))throw Error('Prerequisite evidence unavailable');return b.result;}
 const [token,permit,code,manager]=await Promise.allSettled([
 rpc('eth_call',[{to:route.settlement,data:encodeFunctionData({abi:tokenAbi,functionName:'allowance',args:[route.address as Hex,EXECUTION_CONTRACTS.permit2]})},route.block]),
 rpc('eth_call',[{to:EXECUTION_CONTRACTS.permit2,data:encodeFunctionData({abi:permitAbi,functionName:'allowance',args:[route.address as Hex,route.settlement as Hex,EXECUTION_CONTRACTS.router]})},route.block]),
 rpc('eth_getCode',[EXECUTION_CONTRACTS.router,route.block]),
 rpc('eth_call',[{to:EXECUTION_CONTRACTS.router,data:encodeFunctionData({abi:routerAbi,functionName:'poolManager'})},route.block]),
 ]);
 if(token.status==='fulfilled'){try{result.tokenAllowanceRaw=String(decodeFunctionResult({abi:tokenAbi,functionName:'allowance',data:token.value}));}catch{/* Unknown is not zero. */}}
 if(permit.status==='fulfilled'){try{const [amount,expiry]=decodeFunctionResult({abi:permitAbi,functionName:'allowance',data:permit.value});result.permitAllowanceRaw=String(amount);result.permitExpiresAt=new Date(Number(expiry)*1000).toISOString();}catch{/* Unknown is not zero. */}}
 if(manager.status==='fulfilled'){try{result.routerManager=String(decodeFunctionResult({abi:routerAbi,functionName:'poolManager',data:manager.value})).toLowerCase();}catch{/* Unsupported or malformed getters remain unverified. */}}
 if(code.status==='fulfilled'&&code.value!=='0x')result.routerCodeHash=keccak256(code.value);
 // A canonicality recheck covers all prerequisite reads as well as the earlier quote.
 try{const id=++serial;const r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method:'eth_getBlockByNumber',params:[route.block,false]}),signal:AbortSignal.timeout(10000),cache:'no-store'});const b=await r.json() as {id:number;result?:{hash:string}};if(!r.ok||b.id!==id||b.result?.hash!==route.blockHash)throw Error('Block changed');}catch{throw Error('Prerequisite block could not be verified');}
 const check=(name:string,state:'pass'|'fail'|'pending',reason:string)=>result.checks.push({name,state,reason});
 check('Approved stock',!mandate?'pending':mandate.allowedSymbols.includes(route.symbol)?'pass':'fail',!mandate?'Save boundaries first.':`${route.symbol} checked against mandate v${mandate.version}.`);
 check('Observed settlement funds',BigInt(route.balanceRaw)>=BigInt(route.inputRaw)?'pass':'fail','USDG balance at the quoted block; this is not daily budget or total portfolio evidence.');
 check('Token allowance to Permit2',result.tokenAllowanceRaw===null?'pending':BigInt(result.tokenAllowanceRaw)>=BigInt(route.inputRaw)?'pass':'fail','Existing allowance read only. No approval was requested or changed.');
 check('Permit2 allowance to router',result.permitAllowanceRaw===null||result.permitExpiresAt===null?'pending':BigInt(result.permitAllowanceRaw)>=BigInt(route.inputRaw)&&Date.parse(result.permitExpiresAt)>=Date.parse(route.expiresAt)?'pass':'fail','Existing amount and expiry must cover this intent. An allowance is not agent authority.');
 check('Quote freshness',Date.now()<Date.parse(route.expiresAt)?'pass':'fail','Historical evidence only; every execution needs a new quote and recheck.');
 check('Router pool manager',!result.routerManager?'pending':result.routerManager===VENUE.manager?'pass':'fail','Observed router poolManager getter must match the canonical Uniswap v4 manager. This verifies one link, not the full execution interface or an audit.');
 check('Router implementation and full simulation','pending','Code fingerprint recorded when available. Deployed interface, audited enforcement and full wallet simulation remain unverified.');
 check('Dollar limits and concentration','pending','USDG token units are not a verified USD price. Daily pending spend and full portfolio valuation must be reconciled.');
 check('Wallet authority and eligibility','pending','Watch-only inspection grants no ownership, spending permission or trading eligibility.');
 return result;
}
