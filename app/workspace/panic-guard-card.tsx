'use client';
import {useEffect,useState} from 'react';
import {Siren} from 'lucide-react';
type Settings={dropBps:number;lossCents:number|null;cooloffHours:number};
type Guard={settings:Settings;state:{peakMicro:string|null;startMicro:string|null;reason:string|null}|null;coolingUntil:string|null};
const usd=(micro:string)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(BigInt(micro))/1e6);
export default function PanicGuardCard(){
 const [guard,setGuard]=useState<Guard|null>(null),[draft,setDraft]=useState<Settings|null>(null),[loss,setLoss]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 useEffect(()=>{let live=true;fetch('/api/workspace/autonomy/guard',{cache:'no-store'}).then(async r=>{const b=await r.json() as Guard&{error?:string};if(!r.ok)throw Error(b.error);if(live){setGuard(b);setDraft(b.settings);setLoss(b.settings.lossCents?String(b.settings.lossCents/100):'');}}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Unavailable.');});return()=>{live=false;};},[]);
 async function save(){if(!draft)return;setBusy(true);setError('');setSaved(false);try{const lossCents=loss.trim()?Math.round(Number(loss)*100):null;if(lossCents!==null&&!Number.isFinite(lossCents))throw Error('Enter a dollar amount or leave it empty.');const r=await fetch('/api/workspace/autonomy/guard',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,lossCents})});const b=await r.json() as {settings?:Settings;error?:string};if(!r.ok)throw Error(b.error);setGuard(g=>g?{...g,settings:b.settings!}:g);setSaved(true);}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}}
 if(error&&!guard)return <section className="ws-guard"><p className="ws-error">{error}</p></section>;
 if(!guard||!draft)return null;
 const peak=guard.state?.peakMicro;
 return <section className="ws-guard" aria-label="Panic guard">
  <header><Siren size={20} aria-hidden="true"/><div><span className="ws-label">PANIC GUARD</span><h4>{guard.coolingUntil?'Tripped. Cooling off.':'Stops automatic trading if things go wrong.'}</h4></div></header>
  {guard.coolingUntil?<p className="ws-guard-tripped">{guard.state?.reason} Automatic trading resumes only after {new Date(guard.coolingUntil).toLocaleString()}, and only if you choose Resume.</p>
   :<p>If your account falls this far from its high, Steward pauses itself and you have to wait out the cool-off before resuming. No rage-restarting.</p>}
  <div className="ws-auto-choices">
   <label>Pause if it falls<select value={draft.dropBps} disabled={busy} onChange={e=>setDraft({...draft,dropBps:Number(e.target.value)})}>{[500,1000,1500,2000].map(v=><option key={v} value={v}>{v/100}% from its high</option>)}</select></label>
   <label>Or if it loses · USD (optional)<input inputMode="decimal" placeholder="No dollar limit" value={loss} disabled={busy} onChange={e=>setLoss(e.target.value.trim())}/></label>
   <label>Then wait<select value={draft.cooloffHours} disabled={busy} onChange={e=>setDraft({...draft,cooloffHours:Number(e.target.value)})}>{[6,24,72].map(v=><option key={v} value={v}>{v} hours before resuming</option>)}</select></label>
  </div>
  <button type="button" className="ws-action-secondary" disabled={busy} onClick={save}>{busy?'Saving…':'Save panic guard'}</button>
  {peak&&<small className="ws-muted"> Tracking from a high of {usd(peak)}.</small>}
  {saved&&<small role="status"> Saved.</small>}
  {error&&<p role="alert" className="ws-error">{error}</p>}
 </section>;
}
