import {encodeAbiParameters,encodeFunctionData,keccak256,parseAbi,parseAbiParameters,type Hex} from 'viem';
import {poolIdentity,VENUE,type RouteEvidence} from './chain-route.ts';
import {tradeIntent} from './trade-intent.ts';
import {EXECUTION_CONTRACTS} from './autonomy.ts';
// Universal Router 2.1.2; v4-periphery pinned at 545a5d2a87228167edde48f3b9eda122d1e3c4d6.
// This is a direct-router RPC simulation candidate, never a session grant or a signed transaction.
const abi=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
const swap=parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)');
const currencyAmount=parseAbiParameters('address currency,uint256 amount');
export type RouterCandidate={from:Hex;to:Hex;data:Hex;value:'0x0';intentDigest:Hex;calldataHash:Hex;sourceRevision:string;submissionEnabled:false};
export function routerCandidate(route:RouteEvidence,version:number|null):RouterCandidate{
 const intent=tradeIntent(route,version);if(route.settlement.toLowerCase()!==VENUE.settlement||route.best?.state!=='quoted'||!route.best.outputRaw||BigInt(route.minimumOutputRaw!)>BigInt(route.best.outputRaw)||BigInt(route.inputRaw)>2n**128n-1n||BigInt(route.minimumOutputRaw!)>2n**128n-1n)throw Error('Unsupported bounded route.');
 if(![[100,1],[500,10],[3000,60],[10000,200]].some(([fee,spacing])=>fee===route.best!.fee&&spacing===route.best!.tickSpacing))throw Error('Unsupported pool key.');
 const {key,poolId,zeroForOne}=poolIdentity(route.token as Hex,route.best.fee,route.best.tickSpacing);if(poolId!==route.best.poolId)throw Error('Pool identity mismatch.');
 const input=encodeAbiParameters(parseAbiParameters('bytes actions,bytes[] params'),['0x060c0f',[
 encodeAbiParameters(swap,[{poolKey:key,zeroForOne,amountIn:BigInt(route.inputRaw),amountOutMinimum:BigInt(route.minimumOutputRaw!),minHopPriceX36:0n,hookData:'0x'}]),
 encodeAbiParameters(currencyAmount,[route.settlement as Hex,BigInt(route.inputRaw)]),
 encodeAbiParameters(currencyAmount,[route.token as Hex,BigInt(route.minimumOutputRaw!)]),
 ]]);
 // SETTLE_ALL uses the initiating account as payer; TAKE_ALL returns output to that same account.
 const data=encodeFunctionData({abi,functionName:'execute',args:['0x10',[input],BigInt(Math.floor(Date.parse(route.expiresAt)/1000))]});
 return {from:route.address as Hex,to:EXECUTION_CONTRACTS.router,data,value:'0x0',intentDigest:intent.digest,calldataHash:keccak256(data),sourceRevision:'universal-router/2.1.2; v4-periphery/545a5d2a87228167edde48f3b9eda122d1e3c4d6',submissionEnabled:false};
}
export function validateRouterCandidate(route:RouteEvidence,version:number|null,candidate:{from:string;to:string;data:string;value:string}){
 try{const expected=routerCandidate(route,version);return candidate.from.toLowerCase()===expected.from.toLowerCase()&&candidate.to.toLowerCase()===expected.to.toLowerCase()&&candidate.value===expected.value&&candidate.data.toLowerCase()===expected.data.toLowerCase();}catch{return false;}
}
