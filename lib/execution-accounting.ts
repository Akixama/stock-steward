import {keccak256,toHex} from 'viem';
export type SaleAccountingBinding={inputToken:string;outputToken:string;minimumOutputRaw:string;outputDecimals:number;outputLowerMicroUsdPerToken:string;outputPriceAt:string;outputPriceSource:string};
export type AccountingEvidence={sale?:SaleAccountingBinding;address:string;chainId:number;blockHash:string;observedAt:string;inventoryComplete:boolean;externalActivityReconciled:boolean;priceSourcesVerified:boolean;settlement:{balanceRaw:string;reservedRaw:string;decimals:number;upperMicroUsdPerToken:string;priceAt:string;source:string};portfolio:{totalMicroUsd:string;positionMicroUsd:string;maximumLossMicroUsd:string;proposedPositionMicroUsd?:string};daily:{day:string;filledCents:number;pendingCents:number}};
export type AccountingLimits={maxOrderCents:number;maxDailyCents:number;maxPositionBps:number};
const raw=(s:string)=>{if(!/^\d{1,78}$/.test(s)||BigInt(s)>2n**256n-1n)throw Error('Invalid integer evidence');return BigInt(s);};
export function executionAccounting(e:AccountingEvidence,inputRaw:string,limits:AccountingLimits,now=Date.now()){
 const checks:{name:string;state:'pass'|'fail'|'pending';reason:string}[]=[];const add=(name:string,state:'pass'|'fail'|'pending',reason:string)=>checks.push({name,state,reason});
 let proposedCents:string|null=null;let projectedBps:string|null=null;let digest:string|null=null;
 try{
 if(!/^0x[0-9a-f]{40}$/i.test(e.address)||e.chainId!==4663||!/^0x[0-9a-f]{64}$/i.test(e.blockHash)||!Number.isFinite(now))throw Error('Invalid account evidence');
 for(const n of [limits.maxOrderCents,limits.maxDailyCents,e.daily.filledCents,e.daily.pendingCents])if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid dollar accounting');
 if(limits.maxOrderCents===0||limits.maxDailyCents===0||!Number.isInteger(limits.maxPositionBps)||limits.maxPositionBps<1||limits.maxPositionBps>10000||!Number.isInteger(e.settlement.decimals)||e.settlement.decimals<0||e.settlement.decimals>18)throw Error('Invalid limits');
 const fresh=(date:string)=>Number.isFinite(Date.parse(date))&&now-Date.parse(date)>=0&&now-Date.parse(date)<=30000;
 const amount=raw(inputRaw),balance=raw(e.settlement.balanceRaw),reserved=raw(e.settlement.reservedRaw),price=raw(e.settlement.upperMicroUsdPerToken);
 if(amount===0n||price===0n||!e.settlement.source)throw Error('Missing positive input or price');
 const dataFresh=fresh(e.observedAt)&&fresh(e.settlement.priceAt)&&e.daily.day===new Date(now).toISOString().slice(0,10);
 const coverage=e.inventoryComplete&&e.externalActivityReconciled&&e.priceSourcesVerified&&dataFresh;
 add('Complete fresh accounting evidence',coverage?'pass':'pending','Full inventory, verified USD price bounds, external activity, current UTC-day fills and fresh canonical account evidence are required.');
 add('Unreserved settlement funds',dataFresh?(balance>=reserved&&balance-reserved>=amount?'pass':'fail'):'pending','Pending raw input remains reserved; unavailable evidence never becomes a zero balance.');
 const scale=10n**BigInt(e.settlement.decimals);const cents=(amount*price+scale*10000n-1n)/(scale*10000n);proposedCents=cents.toString();
 add('Single purchase ceiling',dataFresh&&e.priceSourcesVerified?(cents<=BigInt(limits.maxOrderCents)?'pass':'fail'):'pending','Input is valued at a verified upper USD price bound and rounded upwards; USDG is not assumed to equal one dollar.');
 const daily=BigInt(e.daily.filledCents)+BigInt(e.daily.pendingCents)+cents;
 add('Daily purchase ceiling',coverage?(daily<=BigInt(limits.maxDailyCents)?'pass':'fail'):'pending','Confirmed buys plus unresolved pending spend plus this proposal must fit the daily ceiling.');
 const total=raw(e.portfolio.totalMicroUsd),position=raw(e.portfolio.positionMicroUsd),loss=raw(e.portfolio.maximumLossMicroUsd);
 if(position>total)throw Error('Position exceeds portfolio');const denominator=total>loss?total-loss:0n;
 const proposedPosition=e.portfolio.proposedPositionMicroUsd===undefined?cents*10000n:raw(e.portfolio.proposedPositionMicroUsd);
 const numerator=position+(proposedPosition>cents*10000n?proposedPosition:cents*10000n);if(denominator>0n)projectedBps=((numerator*10000n+denominator-1n)/denominator).toString();
 add('Conservative position concentration',coverage?(denominator>0n&&numerator*10000n<=denominator*BigInt(limits.maxPositionBps)?'pass':'fail'):'pending','Full portfolio denominator is reduced by maximum fees and execution loss; target exposure is increased by the full proposed spend. Stock subtotal alone cannot pass.');
 digest=keccak256(toHex(JSON.stringify({schema:'stock-steward-accounting-v1',evidence:e,inputRaw,limits})));
 }catch{add('Valid accounting inputs','pending','Accounting evidence is malformed or incomplete; no dollar or allocation conclusion is trusted.');proposedCents=null;projectedBps=null;digest=null;}
 return {checks,proposedCents,projectedBps,digest,checksPassed:checks.length>0&&checks.every(c=>c.state==='pass'),executionEnabled:false as const};
}


// Sale inputs are stock units. Buy spend is never credited by sale proceeds.
export function executionSaleAccounting(e:AccountingEvidence,inputRaw:string,limits:AccountingLimits,now=Date.now()){
 const checks:{name:string;state:'pass'|'fail'|'pending';reason:string}[]=[];
 const check=(name:string,passed:boolean,reason:string)=>checks.push({name,state:passed?'pass':'fail',reason});
 let proposedCents:string|null=null,projectedBps:string|null=null,digest:string|null=null;
 try{
  const sale=e.sale;if(!sale)throw Error('Missing sale evidence');
  const address=(s:string)=>/^0x[0-9a-f]{40}$/i.test(s);
  const fresh=(s:string)=>Number.isFinite(Date.parse(s))&&Date.parse(s)<=now&&now-Date.parse(s)<=30000;
  if(!address(e.address)||!address(sale.inputToken)||!address(sale.outputToken)||sale.inputToken.toLowerCase()===sale.outputToken.toLowerCase()||e.chainId!==4663||!/^0x[0-9a-f]{64}$/i.test(e.blockHash)||!Number.isFinite(now))throw Error('Invalid sale account');
  for(const n of [limits.maxOrderCents,limits.maxDailyCents,e.daily.filledCents,e.daily.pendingCents])if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid limits');
  if(limits.maxOrderCents<1||limits.maxDailyCents<1||!Number.isInteger(limits.maxPositionBps)||limits.maxPositionBps<1||limits.maxPositionBps>10000)throw Error('Invalid limits');
  for(const decimals of [e.settlement.decimals,sale.outputDecimals])if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Invalid decimals');
  const amount=raw(inputRaw),balance=raw(e.settlement.balanceRaw),reserved=raw(e.settlement.reservedRaw),price=raw(e.settlement.upperMicroUsdPerToken),outputPrice=raw(sale.outputLowerMicroUsdPerToken),floor=raw(sale.minimumOutputRaw);
  if(!amount||!price||!floor||!outputPrice||!e.settlement.source||!sale.outputPriceSource)throw Error('Missing prices');
  const coverage=e.inventoryComplete&&e.externalActivityReconciled&&e.priceSourcesVerified&&fresh(e.observedAt)&&fresh(e.settlement.priceAt)&&fresh(sale.outputPriceAt)&&e.daily.day===new Date(now).toISOString().slice(0,10);
  check('Complete fresh sale evidence',coverage,'Verified stock holdings, both currency prices and reconciled current-day history are required.');
  check('Unreserved held stock',balance>=reserved&&balance-reserved>=amount,'Pending sales reserve stock units. A sale cannot borrow or short stock.');
  const scale=10n**BigInt(e.settlement.decimals),value=(amount*price+scale-1n)/scale,cents=(value+9999n)/10000n;
  proposedCents=cents.toString();
  check('Single sale ceiling',cents<=BigInt(limits.maxOrderCents),'Sold stock is valued at the verified upper dollar bound.');
  const total=raw(e.portfolio.totalMicroUsd),position=raw(e.portfolio.positionMicroUsd),fees=raw(e.portfolio.maximumLossMicroUsd);
  if(position!==(balance*price+scale-1n)/scale||balance<amount)throw Error('Stock position does not match raw holdings');
  const minimumProceeds=floor*outputPrice/(10n**BigInt(sale.outputDecimals));
  const loss=fees+(value>minimumProceeds?value-minimumProceeds:0n),denominator=total>loss?total-loss:0n;
  const remaining=((balance-amount)*price+scale-1n)/scale;
  if(denominator>0n)projectedBps=((remaining*10000n+denominator-1n)/denominator).toString();
  check('Sale reduces concentration',denominator>0n&&total>0n&&remaining*total<=position*denominator,'The remaining stock share must not increase after bounded execution loss and fees.');
  check('Buy budget preserved',true,'Sales do not refund or consume the daily buy budget.');
  digest=keccak256(toHex(JSON.stringify({schema:'stock-steward-sale-accounting-v1',evidence:e,inputRaw,limits})));
 }catch{checks.push({name:'Valid sale accounting',state:'pending',reason:'Sale accounting is incomplete or malformed.'});proposedCents=null;projectedBps=null;digest=null;}
 return {checks,proposedCents,projectedBps,digest,checksPassed:checks.length>0&&checks.every(c=>c.state==='pass'),executionEnabled:false as const};
}
