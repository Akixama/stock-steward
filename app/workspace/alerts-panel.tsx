'use client';
import {useCallback,useEffect,useState} from 'react';
import {BellRing,Check,X} from 'lucide-react';
import type {PriceAlert} from '@/lib/price-alerts';
import type {Mandate} from '@/lib/decision';
const money=(c:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const cents=(value:string)=>/^\d+(\.\d{1,2})?$/.test(value.trim())?Math.round(Number(value)*100):NaN;
export default function AlertsPanel({mandate}:{mandate:Mandate}){
 const [alerts,setAlerts]=useState<PriceAlert[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [symbol,setSymbol]=useState(mandate.allowedSymbols[0]??'AAPL'),[direction,setDirection]=useState<'above'|'below'>('above'),[price,setPrice]=useState('');
 const load=useCallback(async(check=false)=>{setBusy(true);setError('');try{const r=await fetch(`/api/workspace/alerts${check?'?check=1':''}`,{cache:'no-store'});const data=await r.json() as {alerts?:PriceAlert[];triggered?:PriceAlert[];error?:string;notice?:string};if(!r.ok||!data.alerts)throw Error(data.error??'Could not load alerts.');setAlerts(data.alerts);setNotice(check&&data.triggered?.length?`${data.triggered.length} alert${data.triggered.length===1?'':'s'} triggered on this check.`:'');setLoaded(true);}catch(e){setError(e instanceof Error?e.message:'Could not load alerts.');}finally{setBusy(false);}},[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(!mandate.allowedSymbols.includes(symbol))setSymbol(mandate.allowedSymbols[0]??'AAPL');},[mandate.allowedSymbols,symbol]);
 async function create(){const priceCents=cents(price);if(!Number.isSafeInteger(priceCents)||priceCents<1){setError('Enter a positive alert price.');return;}setBusy(true);setError('');try{const r=await fetch('/api/workspace/alerts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,direction,priceCents})});const data=await r.json() as {alert?:PriceAlert;error?:string};if(!r.ok||!data.alert)throw Error(data.error??'Could not save the alert.');setAlerts([data.alert,...alerts]);setPrice('');setNotice('Alert armed.');}catch(e){setError(e instanceof Error?e.message:'Could not save the alert.');}finally{setBusy(false);}}
 async function remove(id:string){setBusy(true);setError('');try{const r=await fetch('/api/workspace/alerts',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});const data=await r.json() as {removed?:boolean;error?:string};if(!r.ok||!data.removed)throw Error(data.error??'Could not remove the alert.');setAlerts(alerts.filter(a=>a.id!==id));}catch(e){setError(e instanceof Error?e.message:'Could not remove the alert.');}finally{setBusy(false);}}
 return <section className="ws-alerts" aria-busy={busy}>
  <header className="goal-heading"><div><span className="ws-label">WATCHLIST</span><h1>Prices you are watching.</h1><p>Arm a price alert and check it against fresh read-only quotes. Alerts never place an order.</p></div><span className="goal-badge">Checked on demand · USD</span></header>
  {error&&<p className="ws-error" role="alert">{error}</p>}
  {notice&&<p className="ws-alert-notice" role="status"><Check size={15}/> {notice}</p>}
  {!loaded&&!error&&<p role="status">Loading your alerts…</p>}
  <div className="ws-alert-layout">
   <form className="ws-alert-form" onSubmit={e=>{e.preventDefault();void create();}}>
    <div className="ws-alert-fields">
     <label>Stock<select value={symbol} onChange={e=>setSymbol(e.target.value)}>{(mandate.allowedSymbols.length?mandate.allowedSymbols:['AAPL']).map(s=><option key={s}>{s}</option>)}</select></label>
     <label>Crosses<select value={direction} onChange={e=>setDirection(e.target.value as 'above'|'below')}><option value="above">At or above</option><option value="below">At or below</option></select></label>
     <label>Price · USD<input required inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} placeholder="175.00"/></label>
    </div>
    <button className="ws-action-primary" disabled={busy||!price.trim()}>Arm alert <BellRing size={16}/></button>
    <small>Stocks come from your saved Mandate. The comparison uses the indicative bid quote, the same one used to value Practice holdings.</small>
   </form>
   <div className="ws-alert-list">
    {loaded&&!alerts.length&&<p className="ws-alert-empty">No alerts yet. Arm one to watch a price without trading.</p>}
    {alerts.map(alert=><div key={alert.id} className="ws-alert-row" data-status={alert.status}>
     <div><strong>{alert.symbol} {alert.direction==='above'?'at or above':'at or below'} {money(alert.priceCents)}</strong>
      <small>{alert.status==='triggered'?`Triggered ${alert.triggeredAt?new Date(alert.triggeredAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):''} at ${alert.observedPriceCents?money(alert.observedPriceCents):'an observed price'}.`:`Armed ${new Date(alert.createdAt).toLocaleDateString()} · waiting for a fresh quote to cross it.`}</small></div>
     <button className="ws-action-quiet" disabled={busy} onClick={()=>void remove(alert.id)} aria-label={`Remove alert for ${alert.symbol}`}><X size={15}/> Remove</button>
    </div>)}
   </div>
  </div>
  <div className="ws-action-row"><button className="ws-action-secondary" disabled={busy} onClick={()=>void load(true)}>Check prices now</button><span>Alerts are checked when you press this, not in the background. A crossed alert is recorded here as evidence; nothing is bought or sold.</span></div>
 </section>;
}
