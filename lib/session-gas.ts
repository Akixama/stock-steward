import {CHAIN} from './robinhood-chain.ts';
// Automatic trades are paid for from a little ETH on the session key. This
// reads it and turns it into "about N trades left" at the owner's fee limit.
export type GasStatus={balanceWei:string;balanceCents:number|null;maxFeeCents:number;tradesLeft:number|null;state:'ok'|'low'|'empty'|'unknown';topUpWei:string|null};
export const LOW_TRADES=3,TOP_UP_TRADES=10;

export function gasStatus(balanceWei:bigint,ethUsdMicro:bigint|null,maxFeeCents:number):GasStatus{
 if(!ethUsdMicro||ethUsdMicro<=0n||!Number.isSafeInteger(maxFeeCents)||maxFeeCents<1)return {balanceWei:balanceWei.toString(),balanceCents:null,maxFeeCents,tradesLeft:null,state:balanceWei===0n?'empty':'unknown',topUpWei:null};
 const balanceCents=Number(balanceWei*ethUsdMicro/10n**18n/10_000n);
 const tradesLeft=Math.floor(balanceCents/maxFeeCents);
 // Enough ETH for TOP_UP_TRADES more trades at the fee limit, rounded up.
 const topUpWei=(BigInt(maxFeeCents*TOP_UP_TRADES)*10_000n*10n**18n+ethUsdMicro-1n)/ethUsdMicro;
 return {balanceWei:balanceWei.toString(),balanceCents,maxFeeCents,tradesLeft,state:tradesLeft<1?'empty':tradesLeft<LOW_TRADES?'low':'ok',topUpWei:topUpWei.toString()};
}

export async function sessionBalanceWei(session:string,rpc:typeof fetch=fetch):Promise<bigint|null>{
 if(!/^0x[0-9a-f]{40}$/i.test(session))return null;
 try{const r=await rpc(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBalance',params:[session,'latest']}),signal:AbortSignal.timeout(10000),cache:'no-store'});
  const b=await r.json() as {id:number;result?:string;error?:unknown};if(!r.ok||b.id!==1||b.error||!/^0x[0-9a-f]+$/i.test(b.result??''))return null;return BigInt(b.result!);}catch{return null;}
}

export async function ethUsdMicro(web:typeof fetch=fetch):Promise<bigint|null>{
 try{const r=await web('https://api.exchange.coinbase.com/products/ETH-USD/ticker',{cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)return null;
  const b=await r.json() as {bid?:string;price?:string};const v=Number(b.bid??b.price);if(!Number.isFinite(v)||v<=0)return null;return BigInt(Math.floor(v*1e6));}catch{return null;}
}
