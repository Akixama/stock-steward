// Stress test: try to break your own guardrail. Every attack is a read-only
// eth_call made AS the session key against your live Roles permission at the
// latest block. Nothing is signed or sent. A refused call is a pass.
import {decodeErrorResult,encodeFunctionData,parseAbi,maxUint256,type Address,type Hex} from 'viem';
import {approvedRouterCall,compileRolesPolicy,rolesAbi,type RolesPolicy} from './roles-permission.ts';
import {VENUE} from './chain-route.ts';
import {CHAIN} from './robinhood-chain.ts';
import {limitsCheck} from './limits-check.ts';

const erc20=parseAbi(['function transfer(address to,uint256 amount) returns (bool)','function approve(address spender,uint256 amount) returns (bool)']);
const safeAbi=parseAbi(['function addOwnerWithThreshold(address owner,uint256 threshold)','function enableModule(address module)']);
const errors=parseAbi(['error NoMembership()','error ConditionViolation(uint8 status,bytes32 info)','error ModuleTransactionFailed()']);
export const ATTACKER='0x000000000000000000000000000000000000dEaD' as Address;

// Zodiac Roles v2 PermissionChecker status codes, in plain words.
const STATUS:Record<number,string>={1:'delegate calls are not allowed',2:'that address is not on the allowed list',3:'that function is not allowed',4:'sending ETH is not allowed',7:'a value in the call is not allowed',8:'an amount is below what is allowed',9:'an amount is above what is allowed',10:'a value does not match the approved one',17:'the spending allowance is used up',18:'the trade-count allowance is used up',19:'the ETH allowance is used up'};
export function refusalReason(data:Hex|undefined):string{
 if(!data)return 'the permission refused it';
 try{const e=decodeErrorResult({abi:errors,data});if(e.errorName==='NoMembership')return 'the key has no permission at all';if(e.errorName==='ConditionViolation')return STATUS[Number(e.args[0])]??`permission rule ${Number(e.args[0])} blocked it`;return 'the wallet rejected the call';}catch{return 'the permission refused it';}
}

const routerCall=(c:{to:string;data:Hex})=>({to:c.to as Address,data:c.data});
export type Attack={id:string;label:string;call:{to:Address;data:Hex;value?:bigint}};
export function buildAttacks(policy:RolesPolicy,unlistedToken:Address|null,now=Math.floor(Date.now()/1000)):Attack[]{
 const usdg=VENUE.settlement as Address,deadline=Math.min(policy.expiresAt-60,now+600);
 const attacks:Attack[]=[
  {id:'drain',label:'Send all your USDG to a stranger',call:{to:usdg,data:encodeFunctionData({abi:erc20,functionName:'transfer',args:[ATTACKER,BigInt(policy.totalRaw)]})}},
  {id:'approve',label:'Let a stranger spend your USDG',call:{to:usdg,data:encodeFunctionData({abi:erc20,functionName:'approve',args:[ATTACKER,maxUint256]})}},
  {id:'owner',label:'Add a new owner to your wallet',call:{to:policy.account,data:encodeFunctionData({abi:safeAbi,functionName:'addOwnerWithThreshold',args:[ATTACKER,1n]})}},
  {id:'module',label:'Install a backdoor module on your wallet',call:{to:policy.account,data:encodeFunctionData({abi:safeAbi,functionName:'enableModule',args:[ATTACKER]})}},
 ];
 try{
  // The approved buy, but for twice your per-trade amount.
  const bigger={...policy,inputRaw:(BigInt(policy.inputRaw)*2n).toString()};
  attacks.push({id:'oversize',label:'Buy twice your per-trade limit',call:routerCall(approvedRouterCall(bigger,policy.outputs[0].token,deadline,'buy'))});
 }catch{/* Policy too small to double; skipped. */}
 if(unlistedToken){try{
  const swapped={...policy,outputs:[{...policy.outputs[0],token:unlistedToken}]};
  attacks.push({id:'offlist',label:'Buy a stock that is not in your Limits',call:routerCall(approvedRouterCall(swapped,unlistedToken,deadline,'buy'))});
 }catch{/* skipped */}}
 return attacks;
}

// A revert is a pass; a successful call is a loud failure.
export function classifyReply(b:{result?:Hex;error?:{data?:Hex}}):{refused:boolean;why:string}{
 return b.error?{refused:true,why:`Refused: ${refusalReason(b.error.data)}.`}:{refused:false,why:'NOT refused. Remove your permission and contact support.'};
}
export type WallResult={id:string;label:string;refused:boolean|null;why:string};
export async function runWallTest(policy:RolesPolicy,attacks:Attack[],fetcher:typeof fetch=fetch):Promise<WallResult[]>{
 const {roleKey}=compileRolesPolicy(policy);
 const out:WallResult[]=[];let id=0;
 for(const attack of attacks){
  const data=encodeFunctionData({abi:rolesAbi,functionName:'execTransactionWithRole',args:[attack.call.to,attack.call.value??0n,attack.call.data,0,roleKey,true]});
  try{
   const r=await fetcher(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'eth_call',params:[{from:policy.session,to:policy.module,data},'latest']}),signal:AbortSignal.timeout(15000),cache:'no-store'});
   out.push({id:attack.id,label:attack.label,...classifyReply(await r.json() as {result?:Hex;error?:{data?:Hex}})});
  }catch{out.push({id:attack.id,label:attack.label,refused:null,why:'Could not run this check right now.'});}
 }
 return out;
}

// The first wall: Steward's own checks, before anything reaches a wallet.
export function stewardChecks(mandate:{allowedSymbols:string[];maxOrderCents:number;maxDailyBuyCents:number;version:number},offList:string|null){
 const rows:{id:string;label:string;refused:boolean;why:string}[]=[];
 const add=(id:string,label:string,symbol:string,cents:number)=>{const r=limitsCheck(mandate,symbol,cents,0);const failed=r.lines.find(l=>!l.ok);rows.push({id,label,refused:!r.fits,why:r.fits?'NOT refused.':`Refused: ${failed!.detail}`});};
 if(mandate.allowedSymbols[0])add('steward-oversize',`Buy ${'$'+(mandate.maxOrderCents*2/100).toFixed(2)} of ${mandate.allowedSymbols[0]} at once`,mandate.allowedSymbols[0],mandate.maxOrderCents*2);
 if(offList)add('steward-offlist',`Buy ${offList}, which is not in your Limits`,offList,Math.min(100,mandate.maxOrderCents));
 if(mandate.allowedSymbols[0])add('steward-daily',`Spend more than your daily limit in one go`,mandate.allowedSymbols[0],mandate.maxDailyBuyCents+1);
 return rows;
}
