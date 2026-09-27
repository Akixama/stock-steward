import {keccak256,toHex} from 'viem';
import {CHAIN} from './robinhood-chain.ts';
import {EXECUTION_CONTRACTS} from './autonomy.ts';
import type {RouteEvidence} from './chain-route.ts';
export function tradeIntent(route:RouteEvidence,mandateVersion:number|null){
 const base={mandateVersion,owner:route.address,recipient:route.address,router:EXECUTION_CONTRACTS.router.toLowerCase(),inputToken:route.settlement,inputRaw:route.inputRaw,outputToken:route.token,minimumOutputRaw:route.minimumOutputRaw,poolId:route.best?.poolId,deadline:route.expiresAt,blockHash:route.blockHash};
 if(route.chainId!==CHAIN.id||!route.id||!route.best||!/^0x[0-9a-f]{40}$/i.test(route.address)||!/^0x[0-9a-f]{40}$/i.test(route.settlement)||!/^0x[0-9a-f]{40}$/i.test(route.token)||route.settlement.toLowerCase()===route.token.toLowerCase()||!/^0x[0-9a-f]{64}$/i.test(route.blockHash)||!/^0x[0-9a-f]{64}$/i.test(route.best.poolId)||!/^\d{1,78}$/.test(route.inputRaw)||(BigInt(route.inputRaw)<=0n||BigInt(route.inputRaw)>2n**256n-1n)||!route.minimumOutputRaw||!/^\d{1,78}$/.test(route.minimumOutputRaw)||(BigInt(route.minimumOutputRaw)<=0n||BigInt(route.minimumOutputRaw)>2n**256n-1n)||!Number.isFinite(Date.parse(route.expiresAt))||(mandateVersion!==null&&(!Number.isSafeInteger(mandateVersion)||mandateVersion<1)))throw Error('Complete bounded trade intent required.');
 return {digest:keccak256(toHex(JSON.stringify({schema:'stock-steward-intent-v1',chainId:CHAIN.id,routeId:route.id,...base}))),...base,minimumOutputRaw:route.minimumOutputRaw,poolId:route.best.poolId};
}
