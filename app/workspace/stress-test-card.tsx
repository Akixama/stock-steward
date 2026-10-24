'use client';
import {useState} from 'react';
import {ShieldAlert,Check,X,Minus} from 'lucide-react';
type Row={id:string;label:string;refused:boolean|null;why:string};
type Result={steward:Row[];wall:Row[];permissionActive:boolean;checkedAt?:string};
export default function StressTestCard(){
 const [result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(){setBusy(true);setError('');try{const r=await fetch('/api/workspace/autonomy/stress',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const b=await r.json() as Result&{error?:string};if(!r.ok)throw Error(b.error);setResult(b);}catch(e){setError(e instanceof Error?e.message:'Unavailable.');}finally{setBusy(false);}}
 const all=[...(result?.steward??[]),...(result?.wall??[])],broken=all.some(r=>r.refused===false);
 const icon=(r:Row)=>r.refused===true?<Check size={15} aria-label="Refused"/>:r.refused===false?<X size={15} aria-label="Not refused"/>:<Minus size={15} aria-label="Unknown"/>;
 return <section className="ws-stress" aria-label="Stress test">
  <header><ShieldAlert size={20} aria-hidden="true"/><div><span className="ws-label">STRESS TEST</span><h4>Try to break your own guardrail.</h4></div></header>
  <p>We attack your account the way a bug or a thief would: draining your USDG, adding an owner, buying off your list, buying too much. Each attempt is a read-only simulation, so nothing is signed or sent. Every line should say <strong>Refused</strong>.</p>
  <button type="button" className="ws-action-secondary" disabled={busy} onClick={run}>{busy?'Attacking…':result?'Run again':'Run the stress test'}</button>
  {error&&<p role="alert" className="ws-error">{error}</p>}
  {result&&<>
   <p className={broken?'ws-stress-bad':'ws-stress-good'} role="status">{broken?'Something got through. Pause and remove your permission now.':`${all.filter(r=>r.refused).length} of ${all.length} attacks refused.`}</p>
   <h5>Wall 1 · Steward’s checks</h5>
   <ul className="ws-stress-list">{result.steward.map(r=><li key={r.id} data-state={String(r.refused)}>{icon(r)}<div><strong>{r.label}</strong><small>{r.why}</small></div></li>)}</ul>
   <h5>Wall 2 · Your wallet permission, on chain</h5>
   {result.permissionActive?<ul className="ws-stress-list">{result.wall.map(r=><li key={r.id} data-state={String(r.refused)}>{icon(r)}<div><strong>{r.label}</strong><small>{r.why}</small></div></li>)}</ul>:<p className="ws-muted">Set up automatic mode to test the on-chain wall. Without a permission, nothing can trade for you at all.</p>}
  </>}
 </section>;
}
