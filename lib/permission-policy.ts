import {decodeAbiParameters,decodeFunctionData,encodeAbiParameters,encodeFunctionData,parseAbi,parseAbiParameters} from 'viem';
import {EXECUTION_CONTRACTS} from './autonomy.ts';
import {VENUE,poolIdentity} from './chain-route.ts';

// Reference specification for a future installed policy, NOT a wallet validator.
// No grant generator or submission adapter may use this as evidence of onchain enforcement.
export type PermissionPolicy={account:string;session:string;chainId:4663;expiresAt:number;revoked:boolean;outputs:string[];perTradeRaw:string;remainingTotalRaw:string;remainingDailyRaw:string};
export type PermissionCall={sender:string;account:string;chainId:number;to:string;value:string;operation:number;data:`0x${string}`};
const outer=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
const inner=parseAbiParameters('bytes actions,bytes[] params');
const swap=parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)');
const amount=parseAbiParameters('address currency,uint256 amount');
const address=(a:string)=>/^0x[0-9a-f]{40}$/i.test(a)&&!/^0x0{40}$/i.test(a);
const raw=(a:string)=>/^\d{1,39}$/.test(a)&&BigInt(a)<=2n**128n-1n;
export function inspectPermissionCall(p:PermissionPolicy,c:PermissionCall,nowSeconds:number){
 const deny=(reason:string)=>({matches:false,reason,onchainEnforced:false as const,executionEnabled:false as const});
 try{
  if(!Number.isSafeInteger(nowSeconds)||nowSeconds<0||!address(p.account)||!address(p.session)||!Number.isSafeInteger(p.expiresAt)||!p.outputs.length||p.outputs.length>100||p.outputs.some(t=>!address(t)||t.toLowerCase()===VENUE.settlement)||![p.perTradeRaw,p.remainingTotalRaw,p.remainingDailyRaw].every(raw))return deny('Invalid policy');
  if(p.revoked||nowSeconds>=p.expiresAt)return deny('Revoked or expired');
  if(c.chainId!==4663||p.chainId!==4663||c.sender.toLowerCase()!==p.session.toLowerCase()||c.account.toLowerCase()!==p.account.toLowerCase())return deny('Wrong authority or network');
  if(c.operation!==0||!/^0x0+$/.test(c.value)||c.to.toLowerCase()!==EXECUTION_CONTRACTS.router.toLowerCase())return deny('Only zero-value router calls');
  const decoded=decodeFunctionData({abi:outer,data:c.data});
  const [commands,inputs,deadline]=decoded.args;
  if(commands!=='0x10'||inputs.length!==1||deadline<=BigInt(nowSeconds)||deadline>BigInt(p.expiresAt)||deadline>BigInt(nowSeconds+30))return deny('Command structure or deadline');
  const [actions,params]=decodeAbiParameters(inner,inputs[0]);
  if(actions!=='0x060c0f'||params.length!==3)return deny('Only one swap, settle and owner payout');
  const [s]=decodeAbiParameters(swap,params[0]);
  const [inputToken,maximum]=decodeAbiParameters(amount,params[1]);
  const [outputToken,minimum]=decodeAbiParameters(amount,params[2]);
  if(inputToken.toLowerCase()!==VENUE.settlement||!p.outputs.some(t=>t.toLowerCase()===outputToken.toLowerCase()))return deny('Token not permitted');
  const expected=poolIdentity(outputToken,s.poolKey.fee,s.poolKey.tickSpacing);
  if(![[100,1],[500,10],[3000,60],[10000,200]].some(([f,t])=>f===s.poolKey.fee&&t===s.poolKey.tickSpacing)||s.poolKey.currency0.toLowerCase()!==expected.key.currency0.toLowerCase()||s.poolKey.currency1.toLowerCase()!==expected.key.currency1.toLowerCase()||s.poolKey.hooks.toLowerCase()!==expected.key.hooks.toLowerCase()||s.zeroForOne!==expected.zeroForOne||s.hookData!=='0x'||s.minHopPriceX36!==0n)return deny('Pool, direction or hook not permitted');
  if(s.amountIn<=0n||maximum!==s.amountIn||minimum<=0n||minimum!==s.amountOutMinimum||s.amountIn>BigInt(p.perTradeRaw)||s.amountIn>BigInt(p.remainingTotalRaw)||s.amountIn>BigInt(p.remainingDailyRaw))return deny('Amount or budget not permitted');
  // Reject trailing bytes and noncanonical ABI aliases at every dynamic boundary.
  if(params[0].toLowerCase()!==encodeAbiParameters(swap,[s]).toLowerCase()||params[1].toLowerCase()!==encodeAbiParameters(amount,[inputToken,maximum]).toLowerCase()||params[2].toLowerCase()!==encodeAbiParameters(amount,[outputToken,minimum]).toLowerCase()||inputs[0].toLowerCase()!==encodeAbiParameters(inner,[actions,params]).toLowerCase()||c.data.toLowerCase()!==encodeFunctionData({abi:outer,functionName:'execute',args:[commands,inputs,deadline]}).toLowerCase())return deny('Noncanonical encoding');
  return {matches:true,reason:'Reference raw-token policy matches. Prices, economic slippage, portfolio concentration, deployed enforcement and revocation remain unverified.',onchainEnforced:false as const,executionEnabled:false as const};
 }catch{return deny('Invalid encoding');}
}
