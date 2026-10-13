import {keccak256,toHex,type Hex} from 'viem';
import {validateStrategy,type Strategy} from './strategy.ts';
import type {Mandate} from './decision.ts';

export type LiveAsset={symbol:string;token:Hex;decimals:number;balanceRaw:string;reservedRaw:string;lowerMicroUsd:string;upperMicroUsd:string;priceAt:string;source:string;halted:boolean;shareLowerMicroUsd?:string;shareUpperMicroUsd?:string;previousUpperMicroUsd?:string;previousAt?:string};
export type LiveNews={id:string;symbols:string[];headline:string;source:string;publishedAt:string};
export type LiveStrategySnapshot={account:Hex;blockHash:Hex;observedAt:string;inventoryComplete:boolean;historyComplete:boolean;assets:LiveAsset[];filledBuyCents:number;pendingBuyCents:number;spendDay:string;lastFillAt:string|null;maximumFeeMicroUsd:string;news?:{verified:boolean;complete:boolean;observedAt:string;items:LiveNews[]}};
export type LiveStrategyDecision={state:'held'|'ready';newsEventId?:string;side:'buy'|'sell';symbol:string;inputToken:Hex|null;outputToken:Hex|null;inputRaw:string|null;maximumInputMicroUsd:string|null;amountCents:number;checks:{name:string;passed:boolean;detail:string}[];strategyVersion:number;mandateVersion:number;snapshotDigest:Hex|null;intentDigest:Hex|null;executionEnabled:false};
const integer=(s:string)=>/^\d{1,78}$/.test(s)&&BigInt(s)<=2n**256n-1n;
const ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
const fresh=(date:string,now:number,window=30000)=>Number.isFinite(Date.parse(date))&&Date.parse(date)<=now&&now-Date.parse(date)<=window;

// Live planning uses canonical raw holdings and adverse USD price bounds. It
// never treats practice holdings or a headline alone as permission to trade.
export function evaluateLiveStrategy(strategy:Strategy,mandate:Mandate,snapshot:LiveStrategySnapshot,now=Date.now()):LiveStrategyDecision{
 const result:LiveStrategyDecision={state:'held',side:'buy',symbol:strategy.symbol,inputToken:null,outputToken:null,inputRaw:null,maximumInputMicroUsd:null,amountCents:0,checks:[],strategyVersion:strategy.version,mandateVersion:mandate.version,snapshotDigest:null,intentDigest:null,executionEnabled:false};
 const check=(name:string,passed:boolean,detail:string)=>result.checks.push({name,passed,detail});
 try{
  validateStrategy(strategy);
  if(!Number.isSafeInteger(now)||!/^0x[0-9a-f]{40}$/i.test(snapshot.account)||!/^0x[0-9a-f]{64}$/i.test(snapshot.blockHash)||!integer(snapshot.maximumFeeMicroUsd)||!Number.isSafeInteger(mandate.version)||mandate.version<1||[mandate.maxOrderCents,mandate.maxDailyBuyCents,mandate.maxPositionBps,snapshot.filledBuyCents,snapshot.pendingBuyCents].some(n=>!Number.isSafeInteger(n)||n<0)||mandate.maxOrderCents<1||mandate.maxDailyBuyCents<1||mandate.maxPositionBps<1||mandate.maxPositionBps>10000||!Array.isArray(snapshot.assets)||snapshot.assets.length>100)throw Error('Invalid live evidence.');
  if(snapshot.lastFillAt!==null&&(!Number.isFinite(Date.parse(snapshot.lastFillAt))||Date.parse(snapshot.lastFillAt)>now))throw Error('Invalid fill history.');
  const assets=new Map<string,LiveAsset>(),tokens=new Set<string>();let lowerTotal=0n,upperTotal=0n;
  for(const asset of snapshot.assets){
   if(!/^[A-Z][A-Z0-9.]{0,7}$/.test(asset.symbol)||!/^0x[0-9a-f]{40}$/i.test(asset.token)||!Number.isInteger(asset.decimals)||asset.decimals<0||asset.decimals>18||![asset.balanceRaw,asset.reservedRaw,asset.lowerMicroUsd,asset.upperMicroUsd].every(integer)||BigInt(asset.reservedRaw)>BigInt(asset.balanceRaw)||BigInt(asset.lowerMicroUsd)<=0n||BigInt(asset.upperMicroUsd)<BigInt(asset.lowerMicroUsd)||!asset.source||assets.has(asset.symbol)||tokens.has(asset.token.toLowerCase()))throw Error('Invalid asset inventory.');
   assets.set(asset.symbol,asset);tokens.add(asset.token.toLowerCase());const scale=10n**BigInt(asset.decimals);
   lowerTotal+=BigInt(asset.balanceRaw)*BigInt(asset.lowerMicroUsd)/scale;upperTotal+=ceil(BigInt(asset.balanceRaw)*BigInt(asset.upperMicroUsd),scale);
  }
  const settlement=assets.get('USDG');if(!settlement)throw Error('Settlement holdings unavailable.');
  const required=strategy.kind==='portfolio'?strategy.targets!.map(t=>t.symbol):[strategy.symbol];
  if(required.some(symbol=>!assets.has(symbol)))throw Error('A target asset is missing.');
  check('Canonical inventory',snapshot.inventoryComplete&&snapshot.historyComplete&&fresh(snapshot.observedAt,now)&&snapshot.spendDay===new Date(now).toISOString().slice(0,10),'Complete fresh holdings, canonical block and current-day confirmed and pending spend are required.');
  check('Fresh prices',snapshot.assets.every(a=>fresh(a.priceAt,now)&&!a.halted),'Every held or targeted asset needs a fresh verified price bound; halted assets block planning.');
  check('Automatic mandate',mandate.executionPreference==='automatic'&&strategy.mode==='automatic','Both saved strategy and mandate must explicitly select automatic trading.');
  check('Approved targets',required.every(symbol=>mandate.allowedSymbols.includes(symbol)),'Every target must be approved in the saved mandate.');
  const fee=BigInt(snapshot.maximumFeeMicroUsd),denominator=lowerTotal>fee?lowerTotal-fee:0n;
  const elapsed=snapshot.lastFillAt===null||now-Date.parse(snapshot.lastFillAt)>=strategy.intervalHours*3600000;
  check('Trade interval',elapsed,'The interval is measured from the last verified completed trade, never a preview or submission.');
  const bounds=(symbol:string)=>{const a=assets.get(symbol)!;const scale=10n**BigInt(a.decimals);return {asset:a,lower:BigInt(a.balanceRaw)*BigInt(a.lowerMicroUsd)/scale,upper:ceil(BigInt(a.balanceRaw)*BigInt(a.upperMicroUsd),scale)};};
  let symbol=strategy.symbol,side:'buy'|'sell'='buy',amount=BigInt(Math.min(strategy.amountCents,mandate.maxOrderCents))*10000n,trigger=false;
  let targetLimit:number|undefined;
  if(strategy.kind==='portfolio'){
   const choices=strategy.targets!.map(target=>{const position=bounds(target.symbol);const overweight=position.lower*10000n>upperTotal*BigInt(target.targetBps+strategy.driftBps),underweight=position.upper*10000n<lowerTotal*BigInt(Math.max(0,target.targetBps-strategy.driftBps));
    const side=overweight?'sell' as const:'buy' as const;const capacity=side==='sell'?position.lower-upperTotal*BigInt(target.targetBps)/10000n:denominator*BigInt(target.targetBps)/10000n-position.upper;
    return {symbol:target.symbol,side,target:target.targetBps,capacity,eligible:(overweight||underweight)&&capacity>0n};
   }).filter(c=>c.eligible).sort((a,b)=>Number(b.side==='sell')-Number(a.side==='sell')||(a.capacity===b.capacity?a.symbol.localeCompare(b.symbol):a.capacity>b.capacity?-1:1));
   const choice=choices[0];if(choice){symbol=choice.symbol;side=choice.side;amount=amount<choice.capacity?amount:choice.capacity;trigger=true;targetLimit=choice.target;}
  }else{
   const position=bounds(symbol),a=position.asset,below=position.upper*10000n<lowerTotal*BigInt(Math.max(0,strategy.targetBps-strategy.driftBps)),above=position.lower*10000n>upperTotal*BigInt(strategy.targetBps+strategy.driftBps);
   const needsSharePrice=['threshold','sell_threshold','sell_below','price_band','accumulate'].includes(strategy.kind);
   if(needsSharePrice&&(!a.shareLowerMicroUsd||!a.shareUpperMicroUsd||!integer(a.shareLowerMicroUsd)||!integer(a.shareUpperMicroUsd)||BigInt(a.shareLowerMicroUsd)<=0n||BigInt(a.shareUpperMicroUsd)<BigInt(a.shareLowerMicroUsd)))throw Error('Verified underlying share prices are required for price triggers.');
   const bid=BigInt(a.shareLowerMicroUsd??a.lowerMicroUsd),ask=BigInt(a.shareUpperMicroUsd??a.upperMicroUsd),threshold=BigInt(strategy.thresholdCents)*10000n;
   if(['sell_threshold','sell_below','sell_scheduled','news_sell'].includes(strategy.kind))side='sell';
   if(strategy.kind==='price_band'&&bid>=BigInt(strategy.sellThresholdCents!)*10000n)side='sell';
   if(strategy.kind==='rebalance'&&above)side='sell';
   switch(strategy.kind){
    case 'scheduled':case 'sell_scheduled':trigger=true;break;
    case 'threshold':trigger=ask<=threshold;break;
    case 'sell_threshold':trigger=bid>=threshold;break;
    // A stop trigger is established only when even the upper price is below it.
    case 'sell_below':trigger=ask<=threshold;break;
    case 'allocation':trigger=below;targetLimit=strategy.targetBps;break;
    case 'rebalance':trigger=below||above;targetLimit=strategy.targetBps;break;
    case 'price_band':trigger=ask<=threshold||bid>=BigInt(strategy.sellThresholdCents!)*10000n;break;
    case 'accumulate':{
     const prior=a.previousUpperMicroUsd&&integer(a.previousUpperMicroUsd)?BigInt(a.previousUpperMicroUsd):0n;
     const valid=prior>0n&&!!a.previousAt&&Date.parse(a.previousAt)<Date.parse(a.priceAt)&&now-Date.parse(a.previousAt)>=strategy.intervalHours*3600000&&now-Date.parse(a.previousAt)<=strategy.intervalHours*3600000+900000;
     trigger=valid&&(ask>=prior?ask-prior:prior-ask)*10000n<=prior*BigInt(strategy.maxMovementBps);break;
    }
    case 'news_buy':case 'news_sell':{
     const news=snapshot.news,valid=!!news?.verified&&news.complete&&fresh(news.observedAt,now);
     check('Verified news coverage',valid,'News must come from the configured trusted feed with complete symbol-scoped coverage.');
     const matched=valid?news!.items.find(item=>item.id&&item.source&&item.symbols.includes(symbol)&&fresh(item.publishedAt,now,24*3600000)&&(snapshot.lastFillAt===null||Date.parse(item.publishedAt)>Date.parse(snapshot.lastFillAt))&&strategy.newsKeywords!.some(keyword=>item.headline.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))):undefined;
     trigger=!!matched;if(matched)result.newsEventId=matched.id;break;
    }
   }
   if(targetLimit!==undefined){const capacity=side==='buy'?denominator*BigInt(targetLimit)/10000n-position.upper:position.lower-upperTotal*BigInt(targetLimit)/10000n;amount=capacity>0n?(amount<capacity?amount:capacity):0n;}
  }
  result.symbol=symbol;result.side=side;const position=bounds(symbol),input=side==='buy'?settlement:position.asset,output=side==='buy'?position.asset:settlement;
  const scale=10n**BigInt(input.decimals),raw=amount*scale/BigInt(input.upperMicroUsd),maximum=ceil(raw*BigInt(input.upperMicroUsd),scale);
  result.inputToken=input.token;result.outputToken=output.token;result.inputRaw=raw.toString();result.maximumInputMicroUsd=maximum.toString();result.amountCents=Number(ceil(maximum,10000n));
  check('Strategy trigger',trigger,'The strategy must trigger using adverse price and portfolio bounds.');
  check('Bounded trade size',raw>0n&&maximum>0n&&maximum<=BigInt(mandate.maxOrderCents)*10000n,'Raw input rounds down under the USD order ceiling; no floating-point token sizing.');
  check('Unreserved input',BigInt(input.balanceRaw)-BigInt(input.reservedRaw)>=raw,'Only canonical unreserved input tokens may be used.');
  if(side==='buy'){
   const availableCash=(BigInt(settlement.balanceRaw)-BigInt(settlement.reservedRaw)-raw)*BigInt(settlement.lowerMicroUsd)/(10n**BigInt(settlement.decimals));
   check('Cash reserve',availableCash>=BigInt(strategy.reserveCents)*10000n+fee,'Retain the cash reserve plus complete maximum network fees.');
   check('Daily buy budget',(BigInt(snapshot.filledBuyCents)+BigInt(snapshot.pendingBuyCents))*10000n+maximum<=BigInt(mandate.maxDailyBuyCents)*10000n,'Confirmed and pending buys share one budget; sales do not erase today’s spend.');
   check('Concentration',denominator>0n&&(position.upper+maximum)*10000n<=denominator*BigInt(mandate.maxPositionBps),'Do not increase target exposure beyond the conservative post-fee portfolio cap.');
  }else{
   check('Held stock',raw>0n&&BigInt(position.asset.balanceRaw)-BigInt(position.asset.reservedRaw)>=raw,'Sales use exact held token quantities and cannot short a position.');
  }
  result.snapshotDigest=keccak256(toHex(JSON.stringify(snapshot)));
  result.intentDigest=keccak256(toHex(JSON.stringify({schema:'stock-steward-live-strategy-v1',strategy,mandate,snapshotDigest:result.snapshotDigest,symbol,side,inputRaw:result.inputRaw,inputToken:input.token,outputToken:output.token,maximumInputMicroUsd:result.maximumInputMicroUsd})));
  if(result.checks.every(c=>c.passed))result.state='ready';
 }catch{check('Complete live evidence',false,'Missing or malformed canonical holdings, price bounds or saved controls.');result.inputRaw=null;result.maximumInputMicroUsd=null;result.intentDigest=null;result.snapshotDigest=null;}
 return result;
}
