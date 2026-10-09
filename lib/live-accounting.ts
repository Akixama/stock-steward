import type {AccountingEvidence} from './execution-accounting.ts';

// Assembles the live evidence inputs that executionAccounting requires. Every source is
// injectable and may fail; missing proof becomes a gap and a false coverage flag, never a zero.
export type PriceBound={upperMicroUsd:string;lowerMicroUsd:string;priceAt:string;source:string};
export type ObservedBalance={symbol:string;token:string;raw:string;decimals:number};
export type ObservedTransfer={hash:string;from:string;to:string;symbol:string;token:string;raw:string;decimals:number;day:string};
export type AccountingSources={
  block():Promise<{hash:string;observedAt:string}|null>;
  balances(address:string):Promise<ObservedBalance[]|null>;
  transfers(address:string):Promise<{items:ObservedTransfer[];complete:boolean}|null>;
  priceBound(symbol:string):Promise<PriceBound|null>;
};
export type LedgerEvidence={reservedRaw:string;filledCents:number;pendingCents:number;knownHashes:string[];confirmedHashes:string[]};
export type ActivityClassification={hash:string;kind:'steward'|'funding'|'external_buy'|'external_sell'|'withdrawal'|'receive'|'send'|'unknown';day:string;usdCents:string};
export type AccountingAssembly={evidence:AccountingEvidence|null;gaps:string[];activity:ActivityClassification[];externalBuysTodayCents:number};

const integer=(s:string)=>/^\d{1,78}$/.test(s)&&BigInt(s)<=2n**256n-1n;
const day=(now:number)=>new Date(now).toISOString().slice(0,10);
const lower=(s:string)=>String(s).toLowerCase();

export async function buildAccountingEvidence(address:string,targetSymbol:string,lossMarginMicroUsd:string,ledger:LedgerEvidence,sources:AccountingSources,now=Date.now()):Promise<AccountingAssembly>{
 const gaps:string[]=[],activity:ActivityClassification[]=[];
 if(!/^0x[0-9a-f]{40}$/i.test(address)||!targetSymbol||!/^[A-Z][A-Z0-9.]{0,7}$/.test(targetSymbol)||!integer(lossMarginMicroUsd)||BigInt(lossMarginMicroUsd)===0n||!integer(ledger.reservedRaw)||!Number.isSafeInteger(ledger.filledCents)||ledger.filledCents<0||!Number.isSafeInteger(ledger.pendingCents)||ledger.pendingCents<0||!Number.isFinite(now))return {evidence:null,gaps:['Malformed assembly request or ledger evidence.'],activity,externalBuysTodayCents:0};
 const block=await sources.block().catch(()=>null);
 if(!block?.hash||!/^0x[0-9a-f]{64}$/i.test(block.hash)||!Number.isFinite(Date.parse(block.observedAt)))gaps.push('Canonical fresh block evidence unavailable.');
 const balances=await sources.balances(address).catch(()=>null);
 if(balances===null)gaps.push('Complete token balance inventory unavailable.');
 const history=await sources.transfers(address).catch(()=>null);
 if(history===null||!history.complete)gaps.push('Complete address transfer history unavailable; external activity cannot be reconciled.');
 if(gaps.length||balances===null||history===null||!history.complete)return {evidence:null,gaps,activity,externalBuysTodayCents:0};

 const priced=new Map<string,PriceBound>();
 const fresh=(b:PriceBound|null):b is PriceBound=>!!b&&integer(b.upperMicroUsd)&&integer(b.lowerMicroUsd)&&BigInt(b.upperMicroUsd)>=BigInt(b.lowerMicroUsd)&&BigInt(b.lowerMicroUsd)>0n&&Number.isFinite(Date.parse(b.priceAt))&&Math.abs(now-Date.parse(b.priceAt))<=30000&&!!b.source;
 // Both sides of the verified bound are recorded, but every valuation uses the upper bound and
 // rounds upwards: position and total share one valuation side so position can never exceed total.
 const valueOf=(b:ObservedBalance,bound:PriceBound)=>{
  const scale=10n**BigInt(b.decimals),num=BigInt(b.raw)*BigInt(bound.upperMicroUsd);
  return (num+scale-1n)/scale;
 };
 let inventoryComplete=true,priceSourcesVerified=true,externalActivityReconciled=true;
 let totalUpper=0n,positionUpper=0n;
 for(const b of balances){
  if(!integer(b.raw)||!Number.isInteger(b.decimals)||b.decimals<0||b.decimals>18||!b.symbol){inventoryComplete=false;gaps.push('Malformed balance row in inventory.');continue;}
  if(BigInt(b.raw)===0n)continue;
  const bound=await sources.priceBound(b.symbol).catch(()=>null);
  if(!fresh(bound)){priceSourcesVerified=false;inventoryComplete=false;gaps.push(`No fresh verified USD price bound for held asset ${b.symbol}.`);continue;}
  priced.set(lower(b.token),bound);
  totalUpper+=valueOf(b,bound);
  if(b.symbol===targetSymbol)positionUpper+=valueOf(b,bound);
 }
 // The settlement token is priced even when its balance is zero, and never assumed to equal one dollar.
 const settlement=balances.find(b=>b.symbol==='USDG')??{symbol:'USDG',token:'0x'+'0'.repeat(40),raw:'0',decimals:6};
 const sBound=await sources.priceBound('USDG').catch(()=>null);
 if(!fresh(sBound)){priceSourcesVerified=false;gaps.push('No fresh verified settlement-token price bound.');}

 // Reconcile every historical movement. Unexplained or unpriceable movements fail closed.
 const today=day(now);let externalBuysTodayCents=0n;
 const known=new Set(ledger.knownHashes.map(h=>lower(h))),confirmed=new Set(ledger.confirmedHashes.map(h=>lower(h)));
 const byHash=new Map<string,ObservedTransfer[]>();
 for(const t of history.items){if(!integer(t.raw)||!Number.isInteger(t.decimals)||t.decimals<0||t.decimals>18||!t.symbol||!/^0x[0-9a-f]{64}$/i.test(String(t.hash))){externalActivityReconciled=false;gaps.push('Malformed transfer row in chain history.');continue;}const list=byHash.get(lower(t.hash))??[];list.push(t);byHash.set(lower(t.hash),list);}
 const observedHashes=new Set(byHash.keys());
 for(const h of confirmed)if(!observedHashes.has(h)){externalActivityReconciled=false;gaps.push(`Confirmed ledger transaction ${h} is absent from complete chain history.`);}
 for(const [hash,group] of byHash){
  const row={hash,day:group[0].day,usdCents:'0'};
  let classified:ActivityClassification;
  if(known.has(hash))classified={...row,kind:'steward'};
  else{
   const tags=new Set<string>(group.map(t=>{
    const inFlow=lower(t.to)===lower(address);
    if(t.symbol==='USDG'||t.symbol==='ETH')return inFlow?'money_in':'money_out';
    if(t.symbol===targetSymbol)return inFlow?'receive':'target_out';
    return 'unknown';
   }));
   const only=(k:string)=>tags.size===1&&tags.has(k);
   if(tags.has('unknown'))classified={...row,kind:'unknown'};
   else if(tags.size===2&&tags.has('money_out')&&tags.has('receive'))classified={...row,kind:'external_buy'};
   else if(tags.size===2&&tags.has('money_in')&&tags.has('target_out'))classified={...row,kind:'external_sell'};
   else if(only('money_in'))classified={...row,kind:'funding'};
   else if(only('money_out'))classified={...row,kind:'withdrawal'};
   else if(only('receive'))classified={...row,kind:'receive'};
   else if(only('target_out'))classified={...row,kind:'send'};
   else classified={...row,kind:'unknown'};
  }
  if(classified.kind==='unknown'){externalActivityReconciled=false;gaps.push(`Unexplained external movement in transaction ${hash}.`);}
  if(classified.kind==='external_buy'){
   // External buys count against the daily ceiling at a verified upper bound, rounded upwards.
   const target=group.find(t=>t.symbol===targetSymbol&&lower(t.to)===lower(address));
   const bound=target?priced.get(lower(target.token))??null:null;
   if(!target||!bound){externalActivityReconciled=false;gaps.push(`External buy ${hash} cannot be valued.`);}
   else{
    const scale=10n**BigInt(target.decimals);
    const cents=(BigInt(target.raw)*BigInt(bound.upperMicroUsd)+scale*10000n-1n)/(scale*10000n);
    classified.usdCents=cents.toString();
    if(classified.day===today)externalBuysTodayCents+=cents;
   }
  }
  activity.push(classified);
 }
 const complete=inventoryComplete&&externalActivityReconciled&&priceSourcesVerified&&gaps.length===0;
 if(!complete)return {evidence:null,gaps,activity,externalBuysTodayCents:Number(externalBuysTodayCents)};
 return {evidence:{
  address:lower(address),chainId:4663,blockHash:block!.hash,observedAt:block!.observedAt,
  inventoryComplete:true,externalActivityReconciled:true,priceSourcesVerified:true,
  settlement:{balanceRaw:settlement.raw,reservedRaw:ledger.reservedRaw,decimals:settlement.decimals,upperMicroUsdPerToken:sBound!.upperMicroUsd,priceAt:sBound!.priceAt,source:sBound!.source},
  portfolio:{totalMicroUsd:totalUpper.toString(),positionMicroUsd:positionUpper.toString(),maximumLossMicroUsd:lossMarginMicroUsd},
  daily:{day:today,filledCents:ledger.filledCents+Number(externalBuysTodayCents),pendingCents:ledger.pendingCents},
 },gaps,activity,externalBuysTodayCents:Number(externalBuysTodayCents)};
}
