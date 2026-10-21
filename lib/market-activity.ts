type BuyRow={plan_json?:unknown;amount_cents?:unknown;state?:unknown;transaction_hash?:unknown;created_at?:unknown};
type SaleRow={symbol?:unknown;quantity?:unknown;state?:unknown;transaction_hash?:unknown;created_at?:unknown};
export type MarketActivity={side:'buy'|'sell';symbol:string;amount:string;state:string;hash:string;at:string};
const hash=(value:unknown):value is string=>typeof value==='string'&&/^0x[0-9a-f]{64}$/i.test(value);
const state=(value:unknown)=>typeof value==='string'&&['confirmed','reverted','submitted','unknown','attempting'].includes(value)?value:'unknown';
export function marketActivityRows(buys:BuyRow[],sales:SaleRow[]):MarketActivity[]{
  const result:MarketActivity[]=[];
  for(const row of buys){
    if(!hash(row.transaction_hash)||typeof row.created_at!=='string')continue;
    try{const plan=JSON.parse(String(row.plan_json)) as {route?:{symbol?:string;side?:string}};
      if(!/^[A-Z.]{1,8}$/.test(plan.route?.symbol??''))continue;
      result.push({side:plan.route?.side==='sell'?'sell':'buy',symbol:plan.route!.symbol!,amount:typeof row.amount_cents==='number'?`$${(row.amount_cents/100).toFixed(2)}`:'—',state:state(row.state),hash:row.transaction_hash,at:row.created_at});
    }catch{/* A damaged historical row is omitted, not presented as a fill. */}
  }
  for(const row of sales){
    if(!hash(row.transaction_hash)||typeof row.symbol!=='string'||!/^[A-Z.]{1,8}$/.test(row.symbol)||typeof row.created_at!=='string')continue;
    result.push({side:'sell',symbol:row.symbol,amount:typeof row.quantity==='string'?`${row.quantity} tokens`:'—',state:state(row.state),hash:row.transaction_hash,at:row.created_at});
  }
  return result.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,40);
}
