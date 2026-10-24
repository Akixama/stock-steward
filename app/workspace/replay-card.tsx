'use client';
import {useState} from 'react';
import {History} from 'lucide-react';
import type {ReplayResult,ReplayRule} from '@/lib/replay';
const $=(c:number)=>`$${(c/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const when=(iso:string)=>new Date(iso).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
export default function ReplayCard({rule}:{rule:ReplayRule|null}){
 const [days,setDays]=useState<7|30>(30),[result,setResult]=useState<ReplayResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(){if(!rule)return;setBusy(true);setError('');setResult(null);try{const r=await fetch('/api/workspace/replay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rule,days})});const b=await r.json() as {result?:ReplayResult;error?:string};if(!r.ok)throw Error(b.error);setResult(b.result!);}catch(e){setError(e instanceof Error?e.message:'Replay unavailable.');}finally{setBusy(false);}}
 return <section className="ws-replay" aria-label="Replay">
  <header><History size={18} aria-hidden="true"/><div><span className="ws-label">REPLAY</span><h4>See what this rule would have done.</h4></div></header>
  <div className="ws-replay-run"><select value={days} disabled={busy} onChange={e=>setDays(Number(e.target.value) as 7|30)} aria-label="Replay period"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select><button type="button" className="ws-action-secondary" disabled={busy||!rule} onClick={run}>{busy?'Replaying…':'Replay on real prices'}</button></div>
  {!rule&&<small className="ws-muted">Fill in the rule above to replay it.</small>}
  {error&&<p role="alert" className="ws-error">{error}</p>}
  {result&&<>
   <p className="ws-replay-summary">{result.summary}</p>
   <dl className="ws-auto-terms">
    <div><dt>{result.sells?'Sold':'Bought'}</dt><dd>{result.buys+result.sells} time{result.buys+result.sells===1?'':'s'}</dd></div>
    <div><dt>Result</dt><dd className={result.resultCents>=0?'ws-up':'ws-down'}>{result.resultCents>=0?'+':''}{$(result.resultCents)}{result.resultPct!==null?` (${result.resultPct>=0?'+':''}${result.resultPct}%)`:''}</dd></div>
    <div><dt>Price</dt><dd>{$(result.firstPriceCents)} → {$(result.lastPriceCents)}</dd></div>
    <div><dt>Prices checked</dt><dd>{result.checks.toLocaleString('en-US')}{result.skippedDaily?` · ${result.skippedDaily} held by your daily limit`:''}</dd></div>
   </dl>
   {result.trades.length>0&&<details><summary>Every trade ({result.trades.length})</summary><ul className="ws-replay-trades">{result.trades.map(t=><li key={t.at+t.side}><span>{when(t.at)}</span><strong>{t.side==='buy'?'Buy':'Sell'} {$(t.cents)}</strong><span>at {$(t.priceCents)}</span></li>)}</ul></details>}
   <small className="ws-muted">Uses prices saved every few minutes. Fees, slippage and moves between checks are not included. Past prices do not predict future ones.</small>
  </>}
 </section>;
}
