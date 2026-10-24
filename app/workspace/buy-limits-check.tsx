'use client';
import {useEffect,useState} from 'react';
import {Check,Clock3,X} from 'lucide-react';
import type {Mandate} from '@/lib/decision';
import {limitsCheck,parseDollars} from '@/lib/limits-check';

type Position={ok:boolean;reason?:'stale'|'over'|'unavailable';shareBps?:number;maxPositionBps?:number;allowedCents?:number;totalCents?:number};
const percent=(bps:number)=>`${(bps/100).toFixed(1)}%`;
const money=(cents:number)=>`$${(cents/100).toFixed(2)}`;

// "Would this buy fit my limits?" inside Buy. Advisory only: it sends nothing, and the
// server runs the same checks again before any buy is prepared.
export default function BuyLimitsCheck({mandate,symbol:initialSymbol}:{mandate:Mandate;symbol?:string}){
 const choices=mandate.allowedSymbols.length?mandate.allowedSymbols:['AAPL'];
 const [symbol,setSymbol]=useState(initialSymbol&&choices.includes(initialSymbol)?initialSymbol:choices[0]);
 const [amount,setAmount]=useState((mandate.maxOrderCents/100).toFixed(2));
 const [position,setPosition]=useState<Position|null>(null);
 const amountCents=parseDollars(amount);
 const result=limitsCheck(mandate,symbol,amountCents);
 useEffect(()=>{
  if(!mandate.version||!Number.isSafeInteger(amountCents)||amountCents<1)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{setPosition(null);fetch(`/api/workspace/position-limit?symbol=${encodeURIComponent(symbol)}&amountCents=${amountCents}`,{cache:'no-store',signal:controller.signal})
   .then(response=>response.json() as Promise<Position>).then(setPosition).catch(()=>{if(!controller.signal.aborted)setPosition({ok:false,reason:'unavailable'});});},400);
  return()=>{clearTimeout(timer);controller.abort();};
 },[symbol,amountCents,mandate.version]);
 const max=position?.maxPositionBps??mandate.maxPositionBps;
 const positionLine=!position?{state:'pending',detail:'Checking…'}
  :position.ok?{state:'ok',detail:`${percent(position.shareBps??0)} of your Steward wallet after this buy. Limit ${percent(max)}.`}
  :position.reason==='over'?{state:'blocked',detail:`Would be ${percent(position.shareBps??0)} (limit ${percent(max)}). You can hold up to ${money(position.allowedCents??0)} of ${symbol}.`}
  :position.reason==='stale'?{state:'blocked',detail:'Could not check. Open Home to refresh your wallet value.'}
  :{state:'pending',detail:'Connect and verify your wallet to check this.'};
 const fits=result.fits&&position?.ok===true;
 return <details className="ws-buy-limits">
  <summary>Would this buy fit my limits?</summary>
  <div className="ws-buy-limits-fields">
   <label>Stock<select value={symbol} onChange={event=>setSymbol(event.target.value)}>{choices.map(choice=><option key={choice}>{choice}</option>)}</select></label>
   <label>Amount · USD<input inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)}/></label>
  </div>
  <ul>{result.lines.map(line=><li key={line.label} data-ok={line.ok}>{line.ok?<Check size={15} aria-hidden="true"/>:<X size={15} aria-hidden="true"/>}<strong>{line.label}</strong> {line.detail}</li>)}
   {result.lines.length>1&&<li data-ok={positionLine.state==='ok'?true:positionLine.state==='blocked'?false:undefined}>{positionLine.state==='ok'?<Check size={15} aria-hidden="true"/>:positionLine.state==='blocked'?<X size={15} aria-hidden="true"/>:<Clock3 size={15} aria-hidden="true"/>}<strong>Max in one stock</strong> {positionLine.detail}</li>}</ul>
  <p className="ws-muted">{fits?'This fits your limits.':!result.fits||positionLine.state==='blocked'?'This would be blocked.':'Finishing the check…'}</p>
 </details>;
}
