'use client';
import {useState} from 'react';
import {Check,X} from 'lucide-react';
import type {Mandate} from '@/lib/decision';
import {limitsCheck,parseDollars} from '@/lib/limits-check';

// "Would this buy fit my limits?" inside Buy. Advisory only: it sends nothing.
export default function BuyLimitsCheck({mandate,symbol:initialSymbol}:{mandate:Mandate;symbol?:string}){
 const choices=mandate.allowedSymbols.length?mandate.allowedSymbols:['AAPL'];
 const [symbol,setSymbol]=useState(initialSymbol&&choices.includes(initialSymbol)?initialSymbol:choices[0]);
 const [amount,setAmount]=useState((mandate.maxOrderCents/100).toFixed(2));
 const result=limitsCheck(mandate,symbol,parseDollars(amount));
 return <details className="ws-buy-limits">
  <summary>Would this buy fit my limits?</summary>
  <div className="ws-buy-limits-fields">
   <label>Stock<select value={symbol} onChange={event=>setSymbol(event.target.value)}>{choices.map(choice=><option key={choice}>{choice}</option>)}</select></label>
   <label>Amount · USD<input inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)}/></label>
  </div>
  <ul>{result.lines.map(line=><li key={line.label} data-ok={line.ok}>{line.ok?<Check size={15} aria-hidden="true"/>:<X size={15} aria-hidden="true"/>}<strong>{line.label}</strong> {line.detail}</li>)}</ul>
  <p className="ws-muted">{result.fits?'This fits your limits.':'This would be blocked.'}</p>
 </details>;
}
