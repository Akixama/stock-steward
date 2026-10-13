import {formatUnits,type Hex} from 'viem';
import {listSpendEvidence} from '../db/execution-attempts.ts';
import {liveStrategyHistory,observeStrategyPrices} from '../db/live-strategy-state.ts';
import {executionAccountingSources,type ExecutionAnchor} from './execution-sources.ts';
import {buildAccountingEvidence} from './live-accounting.ts';
import {evaluateLiveStrategy,type LiveAsset,type LiveStrategySnapshot} from './live-strategy.ts';
import {readLiveNews,type NewsConfiguration} from './live-news.ts';
import {inspectTradeRoute} from './chain-route.ts';
import {selectStoredFloor} from './live-order.ts';
import {inspectExecutionFees} from './execution-fees.ts';
import {executionAccounting,executionSaleAccounting} from './execution-accounting.ts';
import {rolesOperation} from './roles-operation.ts';
import {CHAIN} from './robinhood-chain.ts';
import type {RolesPolicy} from './roles-permission.ts';
import type {Strategy} from './strategy.ts';
import type {Mandate} from './decision.ts';
const noNews:NewsConfiguration={enabled:false,realTimeAccessVerified:false,commercialUseVerified:false};
export async function strategyAtBlock(db:D1Database,owner:string,strategy:Strategy,mandate:Mandate,account:Hex,anchor:ExecutionAnchor,feeMicroUsd:string,rpc:typeof fetch=fetch,web:typeof fetch=fetch,newsConfig:NewsConfiguration=noNews){
 const required=strategy.kind==='portfolio'?strategy.targets!.map(t=>t.symbol):[strategy.symbol];
 const sources=await executionAccountingSources(anchor,rpc,web,Date.now(),required);
 const [balances,spend,history]=await Promise.all([sources.balances(account),listSpendEvidence(db,owner,account),liveStrategyHistory(db,owner,account)]);
 if(!balances||!spend)throw Error('Complete holdings and reserved funds unavailable.');
 const historyRead=sources.transfers(account);
 const cached={...sources,balances:async()=>balances,transfers:async()=>historyRead};
 const base=await buildAccountingEvidence(account,required[0],feeMicroUsd,spend,cached);
 if(!base.evidence)throw Error('Complete reconciled trade history unavailable.');
 const assets:LiveAsset[]=[];
 for(const balance of balances){
  if(BigInt(balance.raw)===0n&&!required.includes(balance.symbol)&&balance.symbol!=='USDG')continue;
  const bound=await sources.priceBound(balance.symbol);if(!bound)throw Error('A held or targeted asset has no verified price.');
  assets.push({symbol:balance.symbol,token:balance.token as Hex,decimals:balance.decimals,balanceRaw:balance.raw,reservedRaw:spend.reservedByToken?.[balance.token.toLowerCase()]??'0',...bound,halted:false});
 }
 if(strategy.kind==='accumulate')await observeStrategyPrices(db,owner,account,assets,anchor.hash,strategy.intervalHours);
 let news:LiveStrategySnapshot['news'];if(strategy.kind==='news_buy'||strategy.kind==='news_sell'){const result=await readLiveNews(required,newsConfig,web);news={...result.news,items:result.news.items.filter(item=>!history.usedNews.has(item.id))};}
 const snapshot:LiveStrategySnapshot={account,blockHash:anchor.hash as Hex,observedAt:anchor.observedAt,inventoryComplete:true,historyComplete:true,assets,filledBuyCents:base.evidence.daily.filledCents,pendingBuyCents:spend.pendingCents,spendDay:base.evidence.daily.day,lastFillAt:history.lastFillAt,maximumFeeMicroUsd:feeMicroUsd,news};
 if(!await sources.verifyCanonical())throw Error('Inventory block changed.');
 return {decision:evaluateLiveStrategy(strategy,mandate,snapshot),snapshot,sources:cached,spend};
}
export async function latestStrategyAnchor(rpc:typeof fetch=fetch):Promise<ExecutionAnchor>{
 const response=await rpc(CHAIN.rpc,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getBlockByNumber',params:['latest',false]}),cache:'no-store',signal:AbortSignal.timeout(10000)});
 const body=await response.json() as {id:number;error?:unknown;result:{number:string;hash:string;timestamp:string}};
 if(!response.ok||body.id!==1||body.error||!body.result)throw Error('Canonical strategy block unavailable.');return {...body.result,observedAt:new Date().toISOString()};
}
export async function prepareStrategyTrade(db:D1Database,owner:string,strategy:Strategy,mandate:Mandate,policy:RolesPolicy,maximumFeeMicroUsd:string,rpc:typeof fetch=fetch,web:typeof fetch=fetch,newsConfig:NewsConfiguration=noNews){
 const initial=await strategyAtBlock(db,owner,strategy,mandate,policy.account,await latestStrategyAnchor(rpc),maximumFeeMicroUsd,rpc,web,newsConfig);
 if(initial.decision.state!=='ready')throw Error(initial.decision.checks.filter(c=>!c.passed).map(c=>c.name).join(', '));
 const decision=initial.decision,asset=initial.snapshot.assets.find(a=>a.symbol===decision.symbol)!;
 const sale=decision.side==='sell',leg=sale?policy.sales?.find(s=>s.token.toLowerCase()===asset.token.toLowerCase()):undefined;
 const raw=sale?leg?.inputRaw:policy.inputRaw;if(!raw||BigInt(raw)>BigInt(decision.inputRaw!))throw Error('The reviewed trade lot exceeds this strategy decision.');
 const route=await inspectTradeRoute(policy.account,decision.symbol,formatUnits(BigInt(raw),sale?asset.decimals:6),decision.side,50,rpc);
 if(sale){const probe=route.probes.find(p=>p.state==='quoted'&&p.fee===leg!.fee&&p.tickSpacing===leg!.tickSpacing&&BigInt(p.outputRaw??'0')>=BigInt(leg!.minimumOutputRaw));if(!probe)throw Error('Reviewed sale price floor is unavailable.');route.best=probe;route.minimumOutputRaw=leg!.minimumOutputRaw;}
 else{const selected=selectStoredFloor(route,policy.outputs);route.best=selected.probe;route.minimumOutputRaw=selected.floorRaw;}
 rolesOperation(route,mandate.version,policy);
 const anchor={number:route.block,hash:route.blockHash,timestamp:'0x'+BigInt(Math.floor(Date.parse(route.blockAt)/1000)).toString(16),observedAt:route.observedAt};
 const current=await strategyAtBlock(db,owner,strategy,mandate,policy.account,anchor,maximumFeeMicroUsd,rpc,web,newsConfig);
 if(current.decision.state!=='ready'||current.decision.side!==decision.side||current.decision.symbol!==decision.symbol||current.decision.newsEventId!==decision.newsEventId||BigInt(raw)>BigInt(current.decision.inputRaw!))throw Error('Strategy evidence changed before preparation.');
 const native=await current.sources.priceBound('ETH');if(!native)throw Error('Network fee price unavailable.');const quoted=await inspectExecutionFees(route,mandate.version,policy,native,rpc);
 if(BigInt(quoted.maximumMicroUsd)>BigInt(maximumFeeMicroUsd)||!quoted.sessionFunded)throw Error('Reviewed network fee ceiling exceeded or session unfunded.');
 const loss=BigInt(quoted.maximumMicroUsd)+(sale?0n:(BigInt(strategy.amountCents)*10000n*BigInt(route.slippageBps)+9999n)/10000n+1n);
 const assembly=await buildAccountingEvidence(policy.account,decision.symbol,loss.toString(),current.spend,current.sources);if(!assembly.evidence)throw Error('Trade accounting incomplete.');
 const accounting=assembly.evidence,target=current.snapshot.assets.find(a=>a.symbol===decision.symbol)!,settlement=current.snapshot.assets.find(a=>a.symbol==='USDG')!;
 if(sale){accounting.settlement={balanceRaw:target.balanceRaw,reservedRaw:target.reservedRaw,decimals:target.decimals,upperMicroUsdPerToken:target.upperMicroUsd,priceAt:target.priceAt,source:target.source};accounting.sale={inputToken:target.token,outputToken:settlement.token,minimumOutputRaw:route.minimumOutputRaw!,outputDecimals:settlement.decimals,outputLowerMicroUsdPerToken:settlement.lowerMicroUsd,outputPriceAt:settlement.priceAt,outputPriceSource:settlement.source};}
 else{const scale=10n**BigInt(target.decimals);accounting.portfolio.proposedPositionMicroUsd=((BigInt(route.best!.outputRaw!)*BigInt(target.upperMicroUsd)+scale-1n)/scale).toString();}
 const limits={maxOrderCents:Math.min(strategy.amountCents,mandate.maxOrderCents),maxDailyCents:mandate.maxDailyBuyCents,maxPositionBps:mandate.maxPositionBps};
 const targetBps=strategy.kind==='portfolio'?strategy.targets!.find(t=>t.symbol===decision.symbol)!.targetBps:['allocation','rebalance'].includes(strategy.kind)?strategy.targetBps:undefined;
 if(targetBps!==undefined){
  const lowerTotal=current.snapshot.assets.reduce((sum,a)=>sum+BigInt(a.balanceRaw)*BigInt(a.lowerMicroUsd)/(10n**BigInt(a.decimals)),0n);
  const upperTotal=current.snapshot.assets.reduce((sum,a)=>{const scale=10n**BigInt(a.decimals);return sum+(BigInt(a.balanceRaw)*BigInt(a.upperMicroUsd)+scale-1n)/scale;},0n);
  const scale=10n**BigInt(target.decimals);
  if(sale){const remainingLower=(BigInt(target.balanceRaw)-BigInt(raw))*BigInt(target.lowerMicroUsd)/scale;if(remainingLower*10000n<upperTotal*BigInt(targetBps))throw Error('Sale would cross the allocation target.');}
  else{const positionUpper=(BigInt(target.balanceRaw)*BigInt(target.upperMicroUsd)+scale-1n)/scale;const after=positionUpper+BigInt(accounting.portfolio.proposedPositionMicroUsd!);if(lowerTotal<=loss||after*10000n>(lowerTotal-loss)*BigInt(targetBps))throw Error('Quoted output would cross the allocation target.');}
 }
 const money=(sale?executionSaleAccounting:executionAccounting)(accounting,raw,limits);
 if(!money.checksPassed||!await current.sources.verifyCanonical())throw Error('Trade limits or canonical evidence did not pass.');
 return {route,accounting,limits,quoted,newsEventId:current.decision.newsEventId};
}
