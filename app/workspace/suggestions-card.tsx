'use client';
import {useEffect,useState} from 'react';
import {Sparkles} from 'lucide-react';
import type {ReplayResult,ReplayRule} from '@/lib/replay';
type Suggestion={rule:ReplayRule;reason:string;replay:ReplayResult|null};
const money=(c:number)=>`$${(c/100).toFixed(2)}`;
export function suggestionLine(r:ReplayRule){
 if(r.kind==='sell_trailing')return `Sell ${money(r.amountCents)} of ${r.symbol} if it falls ${(r.trailBps??0)/100}% from its high`;
 if(r.kind==='sell_below')return `Sell ${money(r.amountCents)} of ${r.symbol} if it drops to ${money(r.thresholdCents)}`;
 if(r.kind==='sell_threshold')return `Sell ${money(r.amountCents)} of ${r.symbol} when it rises to ${money(r.thresholdCents)}`;
 if(r.kind==='threshold')return `Buy ${money(r.amountCents)} of ${r.symbol} at ${money(r.thresholdCents)} or less`;
 return `Buy ${money(r.amountCents)} of ${r.symbol} regularly`;
}
// AI proposes; the owner decides. Adding creates a paused rule, never a trade.
export default function SuggestionsCard({onAdd,disabled}:{onAdd:(rule:ReplayRule)=>Promise<void>;disabled:boolean}){
 const [available,setAvailable]=useState<boolean|null>(null),[items,setItems]=useState<Suggestion[]|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[added,setAdded]=useState<string[]>([]);
 useEffect(()=>{let live=true;fetch('/api/workspace/suggestions',{cache:'no-store'}).then(r=>r.json() as Promise<{available?:boolean}>).then(b=>{if(live)setAvailable(!!b.available);}).catch(()=>{if(live)setAvailable(false);});return()=>{live=false;};},[]);
 async function ask(){setBusy(true);setError('');try{const r=await fetch('/api/workspace/suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const b=await r.json() as {suggestions?:Suggestion[];error?:string};if(!r.ok)throw Error(b.error);setItems(b.suggestions??[]);setAdded([]);}catch(e){setError(e instanceof Error?e.message:'Unavailable.');}finally{setBusy(false);}}
 if(available===false)return null;
 return <section className="ws-suggest" aria-label="Steward suggests">
  <header><Sparkles size={18} aria-hidden="true"/><div><span className="ws-label">STEWARD SUGGESTS</span><h4>Ideas from your stocks’ recent prices.</h4></div><button type="button" className="ws-action-secondary" disabled={busy||disabled||available===null} onClick={ask}>{busy?'Thinking…':items?'New ideas':'Get ideas'}</button></header>
  {error&&<p role="alert" className="ws-error">{error}</p>}
  {items&&!items.length&&<p className="ws-muted">No sensible new rule right now. That is a fine answer too.</p>}
  {items&&items.length>0&&<ul>{items.map((s,i)=>{const id=JSON.stringify(s.rule);return <li key={i}>
   <div><strong>{suggestionLine(s.rule)}</strong><small>{s.reason}</small>{s.replay&&<small className="ws-suggest-replay">Last 30 days: {s.replay.buys+s.replay.sells} trade{s.replay.buys+s.replay.sells===1?'':'s'}, <span className={s.replay.resultCents>=0?'ws-up':'ws-down'}>{s.replay.resultCents>=0?'+':''}{money(s.replay.resultCents)}</span></small>}</div>
   <button type="button" className="ws-action-quiet" disabled={disabled||added.includes(id)} onClick={async()=>{await onAdd(s.rule);setAdded(a=>[...a,id]);}}>{added.includes(id)?'Added (paused)':'Add as a paused rule'}</button>
  </li>;})}</ul>}
  <small className="ws-muted">AI ideas, not advice. Each is checked against your Limits and replayed on real saved prices. Steward never starts a suggested rule for you.</small>
 </section>;
}
