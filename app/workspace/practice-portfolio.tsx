'use client';
import type {PracticeEvidence,Strategy} from '@/lib/strategy';

const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);

export default function PracticePortfolio({account,strategy,market}:{account:PracticeEvidence;strategy:Strategy;market:boolean}){
 const total=account.cashCents+Object.values(account.holdingsCents).reduce((sum,value)=>sum+value,0);
 const targets=strategy.kind==='portfolio'?strategy.targets??[]:[];
 const symbols=[...new Set([...targets.map(target=>target.symbol),...Object.entries(account.holdingsCents).filter(([,value])=>value>0).map(([symbol])=>symbol)])];
 if(!symbols.length)return null;
 return <section className="ws-portfolio-snapshot" aria-label="Practice portfolio">
  <div className="ws-portfolio-snapshot-head"><div><strong>Fake portfolio</strong><p>Current cash and holdings. Prices are {market?'read-only indicative quotes':'test values'}; trades use simulated funds.</p></div><div><b>{money(total)} total</b><small>{money(total-100000)} since the last reset</small></div></div>
  <div className="ws-portfolio-snapshot-list">
   <div className="ws-portfolio-snapshot-row"><strong>Cash</strong><span>{money(account.cashCents)}</span><span>{total>0?((account.cashCents/total)*100).toFixed(1):'0.0'}%</span><span>{strategy.kind==='portfolio'?`${(100-targets.reduce((sum,target)=>sum+target.targetBps,0)/100).toFixed(1)}% target`:'Reserve applies to buys'}</span></div>
   {symbols.map(symbol=>{const value=account.holdingsCents[symbol]??0,target=targets.find(item=>item.symbol===symbol),bid=account.pricesCents[symbol],ask=account.askPricesCents?.[symbol]??bid;return <div className="ws-portfolio-snapshot-row" key={symbol}><strong>{symbol}<small>{bid?market?`Bid ${money(bid)} · ask ${money(ask)}`:`Test price ${money(bid)}`:'Set a test price before trading'}</small></strong><span>{money(value)}</span><span>{total>0?((value/total)*100).toFixed(1):'0.0'}%</span><span>{target?`${(target.targetBps/100).toFixed(1)}% target`:''}</span></div>;})}
  </div>
  {account.valuationEstimated&&<small>Older holdings have estimated share quantities. Reset fake funds before testing sales.</small>}
 </section>;
}
