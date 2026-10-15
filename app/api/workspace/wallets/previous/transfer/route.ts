import {env} from 'cloudflare:workers';
import {decodeFunctionResult,encodeFunctionData,formatUnits,keccak256,parseAbi,type Address,type Hex} from 'viem';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {getOwnership} from '@/db/wallet-ownership';
import {D1DecisionLedger} from '@/db/ledger';
import {chainTransport} from '@/lib/chain-transport';
import {getCode,rpcCall,CHAIN_RPC} from '@/app/api/workspace/orders/live/_shared';
import {ownerSafeAbi,ownerTransferTransaction,transferAbi} from '@/lib/previous-wallet-transfer';
import {SAFE_CONTRACTS,SAFE_RUNTIME_HASHES} from '@/lib/safe-setup';
import {registry,USDG} from '@/lib/robinhood-chain';
import type {Mandate} from '@/lib/decision';

const balanceAbi=parseAbi(['function balanceOf(address) view returns (uint256)']);
const proxyAbi=parseAbi(['function masterCopy() view returns (address)']);
async function simulate(from:Address,to:Address,data:Hex,transport:typeof fetch):Promise<Hex>{
 const response=await transport(CHAIN_RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{from,to,data},'latest']}),cache:'no-store'});
 const result=await response.json() as {result?:string;error?:{message?:string}};
 if(!response.ok||result.error||!result.result||!/^0x(?:[0-9a-f]{2})*$/i.test(result.result))throw Error(result.error?.message??'Transfer simulation failed. No transaction was sent.');
 return result.result as Hex;
}

// Returns an unsigned, single-token transfer. The recipient is always the
// verified owner of this account; the browser cannot choose a different one.
export async function POST(request:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in first.'},{status:401});
 if(!env.DB)return Response.json({error:'Workspace storage is unavailable.'},{status:503});
 try{
  const body=await request.json() as {symbol?:unknown};
  const symbol=typeof body.symbol==='string'?body.symbol.trim().toUpperCase():'';
  if(symbol!=='USDG'&&!/^[A-Z][A-Z0-9.]{0,7}$/.test(symbol))return Response.json({error:'Choose a listed asset.'},{status:400});
  const [current,ownership]=await Promise.all([new D1DecisionLedger(env.DB).getMandate(user.userId),getOwnership(env.DB,user.userId)]);
  if(!current||!ownership?.verifiedAt||!/^0x[0-9a-f]{40}$/i.test(ownership.address))return Response.json({error:'Verify your owner wallet first.'},{status:403});
  const previous=await env.DB.prepare(`SELECT a.safe, a.mandate_version AS version, m.policy_json AS policy FROM active_modules a JOIN mandates m ON m.owner_ref=a.owner_ref AND m.version=a.mandate_version WHERE a.owner_ref=? AND a.mandate_version<? ORDER BY a.mandate_version DESC LIMIT 1`).bind(user.userId,current.version).first<{safe:string;version:number;policy:string}>();
  if(!previous||!/^0x[0-9a-f]{40}$/i.test(previous.safe))return Response.json({error:'Earlier wallet unavailable.'},{status:404});
  const safe=previous.safe as Address,owner=ownership.address as Address,transport=chainTransport(env.ALCHEMY_API_KEY);
  const code=await getCode(safe,transport);
  if(keccak256(code as Hex).toLowerCase()!==SAFE_RUNTIME_HASHES.proxy.toLowerCase())throw Error('Earlier wallet code does not match the verified Safe proxy.');
  const implementationRaw=await rpcCall(safe,encodeFunctionData({abi:proxyAbi,functionName:'masterCopy'}),'latest',transport);
  const implementation=decodeFunctionResult({abi:proxyAbi,functionName:'masterCopy',data:implementationRaw}) as Address;
  if(implementation.toLowerCase()!==SAFE_CONTRACTS.singleton.toLowerCase())throw Error('Earlier wallet implementation changed. Transfer is blocked.');
  const [ownerRaw,thresholdRaw]=await Promise.all([rpcCall(safe,encodeFunctionData({abi:ownerSafeAbi,functionName:'getOwners'}),'latest',transport),rpcCall(safe,encodeFunctionData({abi:ownerSafeAbi,functionName:'getThreshold'}),'latest',transport)]);
  const owners=decodeFunctionResult({abi:ownerSafeAbi,functionName:'getOwners',data:ownerRaw}) as readonly Address[];
  const threshold=decodeFunctionResult({abi:ownerSafeAbi,functionName:'getThreshold',data:thresholdRaw}) as bigint;
  if(threshold!==1n||owners.length!==1||owners[0].toLowerCase()!==owner.toLowerCase())throw Error('Owner or signing threshold changed. Transfer is blocked.');
  let token:Address,decimals:number;
  if(symbol==='USDG'){token=USDG.contract;decimals=USDG.decimals;}
  else{
   const mandate=JSON.parse(previous.policy) as Mandate;
   if(!mandate.allowedSymbols.includes(symbol))throw Error('This asset was not in the earlier mandate.');
   const response=await fetch('https://api.robinhood.com/rhj/assets',{cache:'no-store',signal:AbortSignal.timeout(8000)});
   if(!response.ok)throw Error('Official asset registry unavailable.');
   const match=registry(await response.json()).find(asset=>asset.symbol===symbol);
   if(!match)throw Error('Asset is missing from the official Robinhood Chain registry.');
   token=match.contract as Address;decimals=18;
  }
  const raw=await rpcCall(token,encodeFunctionData({abi:balanceAbi,functionName:'balanceOf',args:[safe]}),'latest',transport);
  const amount=decodeFunctionResult({abi:balanceAbi,functionName:'balanceOf',data:raw}) as bigint;
  const tx=ownerTransferTransaction({safe,owner,token,amount});
  const direct=await simulate(safe,token,encodeFunctionData({abi:transferAbi,functionName:'transfer',args:[owner,amount]}),transport);
  if(decodeFunctionResult({abi:transferAbi,functionName:'transfer',data:direct})!==true)throw Error('Token transfer did not simulate successfully.');
  const safeResult=await simulate(owner,safe,tx.data,transport);
  if(decodeFunctionResult({abi:ownerSafeAbi,functionName:'execTransaction',data:safeResult})!==true)throw Error('Safe execution did not simulate successfully.');
  return Response.json({symbol,quantity:formatUnits(amount,decimals),safe,owner,token,transaction:{from:tx.from,to:tx.to,value:tx.value,data:tx.data},simulated:true},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Transfer review unavailable. No transaction was sent.'},{status:409,headers:{'Cache-Control':'no-store'}});}
}
