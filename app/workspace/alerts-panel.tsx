'use client';
import {formatWorkspaceDate} from '@/lib/workspace-date';

import {useCallback,useEffect,useState} from 'react';
import {BellRing,Check,Search,X} from 'lucide-react';
import type {PriceAlert} from '@/lib/price-alerts';
import type {Mandate} from '@/lib/decision';
import type {StockCatalogItem} from '@/lib/stock-catalog';
import NotificationInbox from './notification-inbox';
const money=(c:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
const cents=(value:string)=>/^\d+(\.\d{1,2})?$/.test(value.trim())?Math.round(Number(value)*100):NaN;
async function activePushWorker(){
 await navigator.serviceWorker.register('/push-sw.js',{scope:'/'});
 let timeout:ReturnType<typeof setTimeout>|undefined;
 try{
  const registration=await Promise.race([
   navigator.serviceWorker.ready,
   new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Notifications could not start. Reload this page and try again.')),15000);}),
  ]);
  if(!registration.active)throw Error('Notifications could not start. Reload this page and try again.');
  return registration;
 }finally{if(timeout)clearTimeout(timeout);}
}
export default function AlertsPanel({mandate,onCount,onReviewBuy}:{mandate:Mandate;onCount:(count:number)=>void;onReviewBuy:()=>void}){
 const [alerts,setAlerts]=useState<PriceAlert[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[lastChecked,setLastChecked]=useState<Date|null>(null);
 const [pushKey,setPushKey]=useState<string|null>(null),[pushAvailable,setPushAvailable]=useState(false),[deviceEnabled,setDeviceEnabled]=useState(false),[deviceBusy,setDeviceBusy]=useState(false);
 const [symbol,setSymbol]=useState(mandate.allowedSymbols[0]??'AAPL'),[direction,setDirection]=useState<'above'|'below'>('above'),[price,setPrice]=useState('');
 const [stocks,setStocks]=useState<StockCatalogItem[]>([]),[stockSearch,setStockSearch]=useState(''),[stockLoading,setStockLoading]=useState(true),[stockError,setStockError]=useState(''),[stockRetry,setStockRetry]=useState(0);
 const load=useCallback(async(check=false)=>{setBusy(true);setError('');try{const r=await fetch(`/api/workspace/alerts${check?'?check=1':''}`,{cache:'no-store'});const data=await r.json() as {alerts?:PriceAlert[];triggered?:PriceAlert[];error?:string;notice?:string};if(!r.ok||!data.alerts)throw Error(data.error??'Could not load alerts.');setAlerts(data.alerts);if(check){setLastChecked(new Date());window.dispatchEvent(new Event('stock-steward:alerts-updated'));}setNotice(check&&data.triggered?.length?`${data.triggered.length} alert${data.triggered.length===1?'':'s'} triggered on this check.`:'');setLoaded(true);}catch(e){setError(e instanceof Error?e.message:'Could not load alerts.');}finally{setBusy(false);}},[]);
 useEffect(()=>{const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[load]);
 useEffect(()=>{let active=true;fetch('/api/workspace/stocks',{cache:'no-store'}).then(async response=>{const data=await response.json() as {stocks?:StockCatalogItem[];error?:string};if(!response.ok||!data.stocks?.length)throw Error(data.error??'The stock list is unavailable.');return data.stocks;}).then(items=>{if(!active)return;const requested=new URLSearchParams(window.location.search).get('symbol')?.toUpperCase();const preferred=requested&&/^[A-Z][A-Z0-9.]{0,7}$/.test(requested)&&items.some(item=>item.symbol===requested)?requested:null;setStocks(items);setStockError('');setSymbol(current=>preferred??(items.some(item=>item.symbol===current)?current:items[0].symbol));if(preferred)setStockSearch(current=>current||preferred);}).catch(error=>{if(active)setStockError(error instanceof Error?error.message:'The stock list is unavailable.');}).finally(()=>{if(active)setStockLoading(false);});return()=>{active=false;};},[stockRetry]);
 useEffect(()=>{let active=true;void (async()=>{try{const response=await fetch('/api/workspace/alerts/devices',{cache:'no-store'});const config=await response.json() as {available?:boolean;publicKey?:string};if(!active)return;setPushAvailable(Boolean(config.available));setPushKey(config.publicKey??null);if(config.available&&'serviceWorker' in navigator){const registration=await navigator.serviceWorker.getRegistration('/');const subscription=await registration?.pushManager.getSubscription();if(subscription){const saved=await fetch('/api/workspace/alerts/devices',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription)});if(active)setDeviceEnabled(saved.ok);}}}catch{if(active)setPushAvailable(false);}})();return()=>{active=false;};},[]);
 const search=stockSearch.trim().toLowerCase();
 const matchingStocks=stocks.filter(stock=>!search||stock.symbol.toLowerCase().includes(search)||stock.name.toLowerCase().includes(search));
 async function create(){if(!stocks.some(stock=>stock.symbol===symbol)){setError('Choose a supported stock.');return;}const priceCents=cents(price);if(!Number.isSafeInteger(priceCents)||priceCents<1){setError('Enter a positive alert price.');return;}setBusy(true);setError('');try{const r=await fetch('/api/workspace/alerts',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,direction,priceCents})});const data=await r.json() as {alert?:PriceAlert;error?:string};if(!r.ok||!data.alert)throw Error(data.error??'Could not save the alert.');setAlerts([data.alert,...alerts]);setPrice('');setNotice('Alert armed.');}catch(e){setError(e instanceof Error?e.message:'Could not save the alert.');}finally{setBusy(false);}}
 async function remove(id:string){setBusy(true);setError('');try{const r=await fetch('/api/workspace/alerts',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});const data=await r.json() as {removed?:boolean;error?:string};if(!r.ok||!data.removed)throw Error(data.error??'Could not remove the alert.');setAlerts(alerts.filter(a=>a.id!==id));}catch(e){setError(e instanceof Error?e.message:'Could not remove the alert.');}finally{setBusy(false);}}
 async function enableDevice(){if(!pushKey)return;setDeviceBusy(true);setError('');try{const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications were not allowed. You can enable them in this browser’s site settings.');const registration=await activePushWorker();const bytes=Uint8Array.from(atob(pushKey.replace(/-/g,'+').replace(/_/g,'/')),character=>character.charCodeAt(0));const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes.buffer as ArrayBuffer});const response=await fetch('/api/workspace/alerts/devices',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription)});const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error??'Could not save this device.');setDeviceEnabled(true);setNotice('Notifications are on for this device. Alerts are checked about every 15 minutes.');}catch(e){setError(e instanceof Error?e.message:'Could not enable notifications.');}finally{setDeviceBusy(false);}}
 async function disableDevice(){setDeviceBusy(true);setError('');try{const registration=await navigator.serviceWorker.getRegistration('/');const subscription=await registration?.pushManager.getSubscription();if(subscription){const response=await fetch('/api/workspace/alerts/devices',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})});if(!response.ok)throw Error('Could not remove this device.');await subscription.unsubscribe();}setDeviceEnabled(false);setNotice('Notifications are off for this device.');}catch(e){setError(e instanceof Error?e.message:'Could not turn off notifications.');}finally{setDeviceBusy(false);}}
 return <section className="ws-alerts" aria-busy={busy}>
  <NotificationInbox onCount={onCount} onReviewBuy={onReviewBuy}/>
  {error&&<p className="ws-error" role="alert">{error}</p>}
  {notice&&<p className="ws-alert-notice" role="status"><Check size={15}/> {notice}</p>}
  {!loaded&&!error&&<p role="status">Loading your alerts…</p>}
  <div className="ws-alert-device"><div><span className="ws-label">DEVICE NOTIFICATIONS</span><strong>{deviceEnabled?'On for this device':'Get alerts on your laptop or phone'}</strong><p>{deviceEnabled?'Stock Steward checks armed alerts about every 15 minutes, even when the site is closed. Delivery also depends on your device and browser settings.':'Turn on notifications separately on each device. On iPhone or iPad, add Stock Steward to your Home Screen, open it there, then enable notifications.'}</p></div>{pushAvailable&&typeof window!=='undefined'&&'Notification' in window&&'serviceWorker' in navigator&&'PushManager' in window?<button type="button" className="ws-action-secondary" disabled={deviceBusy} onClick={()=>void (deviceEnabled?disableDevice():enableDevice())}>{deviceBusy?'Updating…':deviceEnabled?'Turn off on this device':'Enable notifications'}</button>:<small>Notifications are unavailable in this browser. Open Stock Steward in a supported browser or install it on your phone.</small>}</div>
  <div className="ws-alert-layout">
   <form className="ws-alert-form" onSubmit={e=>{e.preventDefault();void create();}}>
    <div className="ws-alert-fields">
     <div className="ws-alert-stock-field"><label htmlFor="ws-alert-stock-search">Stock to watch</label><p>Alerts can watch any supported stock. Your buying limits still decide which stocks you can buy.</p><div className="ws-stock-search"><Search size={16} aria-hidden="true"/><input id="ws-alert-stock-search" type="search" value={stockSearch} onChange={event=>setStockSearch(event.target.value)} placeholder="Search by company or ticker" aria-controls="ws-alert-stock-results"/></div><div className="ws-alert-stock-choice">Selected: <strong>{stockLoading?'Loading…':symbol}</strong></div>{stockLoading?<small role="status">Loading available stocks…</small>:stockError?<small role="alert">{stockError} <button type="button" onClick={()=>{setStockLoading(true);setStockRetry(value=>value+1);}}>Try again</button></small>:<div id="ws-alert-stock-results" className="ws-alert-stock-results" role="group" aria-label="Available stocks">{matchingStocks.length?matchingStocks.map(stock=><button type="button" key={stock.symbol} aria-pressed={symbol===stock.symbol} onClick={()=>setSymbol(stock.symbol)}><strong>{stock.symbol}</strong><span>{stock.name}</span>{symbol===stock.symbol&&<Check size={15} aria-hidden="true"/>}</button>):<small>No match. Try another name or ticker.</small>}</div>}</div>
     <label>Alert me when the price is<select value={direction} onChange={e=>setDirection(e.target.value as 'above'|'below')}><option value="above">at or above</option><option value="below">at or below</option></select></label>
     <label>Target price · USD<input required inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} placeholder="e.g. 175.00"/></label>
    </div>
    <button className="ws-action-primary" disabled={busy||stockLoading||!!stockError||!stocks.some(stock=>stock.symbol===symbol)||!price.trim()}>Set alert <BellRing size={16}/></button>
    <small>Based on the regular share price. A stock token may cost something different.</small>
   </form>
   <div className="ws-alert-list">
    <div className="ws-alert-list-head"><div><span className="ws-label">YOUR ALERTS</span><small>{lastChecked?`Last checked ${formatWorkspaceDate(lastChecked,{hour:'numeric',minute:'2-digit'})}`:'Not checked this visit'}</small></div><button className="ws-action-secondary" disabled={busy} onClick={()=>void load(true)}>{busy?'Checking…':'Check prices now'}</button></div>
    {loaded&&!alerts.length&&<p className="ws-alert-empty">No alerts yet. Set one to watch a price without trading.</p>}
    {alerts.map(alert=><div key={alert.id} className="ws-alert-row" data-status={alert.status}>
     <div><strong>{alert.symbol}</strong><small>{alert.direction==='above'?'At or above':'At or below'} {money(alert.priceCents)}</small></div>
     <div className="ws-alert-price"><span>Current price</span><strong>{alert.observedPriceCents?money(alert.observedPriceCents):'Check to update'}</strong></div>
     <span className="ws-alert-status">{alert.status==='triggered'?'Triggered':'Waiting'}</span>
     <button className="ws-action-quiet" disabled={busy} onClick={()=>void remove(alert.id)} aria-label={`Delete alert for ${alert.symbol}`}><X size={15}/> Delete</button>
    </div>)}
   </div>
  </div>
  <p className="ws-alert-footnote">We check regular share prices about every 15 minutes. Short price moves may be missed. Alerts never buy or sell for you.</p>
 </section>;
}
