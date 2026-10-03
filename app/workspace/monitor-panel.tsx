'use client';
import {useEffect,useRef,useState} from 'react';import {Pause,Play,Clock3,Activity,RefreshCw,Trash2} from 'lucide-react';
import type {Schedule,WorkerRun} from '@/db/scheduler';import type {TransactionWatch} from '@/lib/chain-reconciliation';import {CHAIN} from '@/lib/robinhood-chain';
type Health={last_started_at:string|null;last_completed_at:string|null;last_summary:string|null};
type Status={schedule:Schedule|null;runs:WorkerRun[];workerConfigured:boolean;health:Health|null};
const time=(value:string|null|undefined)=>value?new Date(value).toLocaleString():'Not yet';
export default function MonitorPanel({address}:{address:string}){
  const [status,setStatus]=useState<Status|null>(null),[watches,setWatches]=useState<TransactionWatch[]>([]),[interval,setIntervalMinutes]=useState('60');
  const [hash,setHash]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');const generation=useRef(0);
  async function load(){const [schedule,transactions]=await Promise.all([fetch('/api/workspace/schedule',{cache:'no-store'}),fetch('/api/workspace/transactions',{cache:'no-store'})]);
    const [rawS,rawT]=await Promise.all([schedule.json(),transactions.json()]);const s=rawS as Status & {error?:string},t=rawT as {watches:TransactionWatch[];error?:string};if(!schedule.ok||!transactions.ok)throw new Error(s.error??t.error??'Monitoring status unavailable.');return {s,w:t.watches};}
  useEffect(()=>{const ticket=++generation.current;load().then(data=>{if(ticket===generation.current){setStatus(data.s);setWatches(data.w);}}).catch(e=>{if(ticket===generation.current)setError(e instanceof Error?e.message:'Monitoring status is unavailable. Refresh to retry.');});return()=>{generation.current++;};},[]);
  async function action(kind:'refresh'|'start'|'pause'|'resume'|'watch'|'remove',id?:string){
    const ticket=++generation.current;setBusy(true);setError('');setMessage('');
    try{
      if(kind!=='refresh'){
        const watching=kind==='watch'||kind==='remove';const previous=id?watches.find(w=>w.id===id):null;const body=watching?(kind==='remove'?{removeId:id}:{address:previous?.address??address,hash:previous?.hash??hash}):{action:kind,revision:status?.schedule?.revision??0,address,interval:Number(interval)};
        const response=await fetch(watching?'/api/workspace/transactions':'/api/workspace/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error??'Could not save changes.');
        if(ticket===generation.current)setMessage(kind==='pause'?'Monitoring paused. Already-running reads may finish, but their results will be discarded. Wallet permissions were not changed.':kind==='watch'?'Transaction watch saved. This is not a trade or proof of a fill.':kind==='remove'?'Transaction watch removed.':'Read-only monitoring scheduled. Automatic spending is still disabled.');
      }
      const data=await load();if(ticket===generation.current){setStatus(data.s);setWatches(data.w);}
    }catch(e){if(ticket===generation.current)setError(e instanceof Error?e.message:'Request failed.');}
    finally{if(ticket===generation.current)setBusy(false);}
  }
  const schedule=status?.schedule;
  return <div className="ws-monitor">
    <div className="ws-monitor-head"><div><span className="ws-label"><Activity size={14}/> WHILE YOU'RE AWAY</span><h3>A watch that keeps its place.</h3></div><span className={`ws-monitor-badge ${schedule?.enabled?'is-active':''}`}><span/>{schedule?.enabled?'Monitoring scheduled':schedule?'Monitoring paused':'No monitor yet'}</span></div>
    <p>Keep observing this public address while the page is closed. Every completed run saves holdings evidence and a blocked readiness receipt. This does not authorize trading.</p>
    <div className="ws-check-fields"><label>Observation interval<select value={interval} disabled={busy} onChange={e=>setIntervalMinutes(e.target.value)}><option value="15">Every 15 minutes</option><option value="30">Every 30 minutes</option><option value="60">Every hour</option><option value="240">Every 4 hours</option><option value="1440">Daily</option></select></label>
      <button disabled={busy||!status?.workerConfigured||!/^0x[0-9a-f]{40}$/i.test(address)} onClick={()=>action('start')}><Clock3 size={16}/>{schedule?'Update monitor for this address':'Start read-only monitoring'}</button></div>
    <div className="ws-chain-tools">{schedule&&<button className="ws-recheck" disabled={busy} onClick={()=>action(schedule.enabled?'pause':'resume')}>{schedule.enabled?<Pause size={14}/>:<Play size={14}/>} {schedule.enabled?'Pause monitoring':'Resume monitoring'}</button>}<button className="ws-recheck" disabled={busy} onClick={()=>action('refresh')}><RefreshCw size={14}/>Refresh status</button></div>
    <p className="ws-chain-note">Cloudflare requests a wake every 15 minutes; actual runs may be delayed. One monitor per signed-in user. Failed reads back off to the next interval; three consecutive failures pause the monitor. Pausing is not wallet-session revocation.</p>
    {status&&!status.workerConfigured&&<p className="ws-chain-note">Background runner configuration is unavailable. Refresh status after setup; no schedule can start yet.</p>}
    {schedule&&<div className="ws-monitor-stats"><div><span>Watched address</span><strong>{schedule.address.slice(0,8)}…{schedule.address.slice(-6)}</strong></div><div><span>Next eligible run</span><strong>{schedule.enabled?time(schedule.next_due_at):'Paused'}</strong></div><div><span>Last observation saved</span><strong>{time(schedule.last_success_at)}</strong></div></div>}
    {schedule?.last_error&&<p className="ws-error">{schedule.last_error}</p>}
    {status?.health&&<p className="ws-chain-note">Worker last woke {time(status.health.last_started_at)} · last batch finished {time(status.health.last_completed_at)}.</p>}
    {status?.runs.length ? <details className="ws-monitor-history"><summary>Worker run trail · latest {status.runs.length}</summary>{status.runs.map(run=><div key={run.id}><span className="ws-monitor-run-state">{run.status}</span><div><strong>{time(run.started_at)}</strong><p>{run.detail??'Read is running; no trading action.'}</p><small>Schedule v{run.revision} · attempt {run.attempts} · {run.address.slice(0,8)}…{run.address.slice(-4)}</small>{run.observation_id&&<small>Observation {run.observation_id}</small>}{run.receipt_id&&<small>Readiness {run.receipt_id}</small>}</div></div>)}</details>:null}
    <div className="ws-monitor-transactions"><span className="ws-label">READ-ONLY TRANSACTION RECONCILIATION</span><h3>Keep uncertain outcomes visible.</h3><p>Track an existing mainnet transaction involving the public address above. Imported transactions are external evidence—not Steward trades. A successful outer transaction does not establish swap output or user-operation success.</p>
      <div className="ws-check-fields"><label>Existing transaction hash<input value={hash} disabled={busy} onChange={e=>setHash(e.target.value.trim())} placeholder="0x…" spellCheck={false}/></label><button disabled={busy||!/^0x[0-9a-f]{40}$/i.test(address)||!/^0x[0-9a-f]{64}$/i.test(hash)} onClick={()=>action('watch')}>Watch transaction</button></div>
      {watches.map(watch=><details key={watch.id} className="ws-transaction-watch"><summary><span>{watch.hash.slice(0,10)}…{watch.hash.slice(-6)}</span><strong>{watch.state.replaceAll('_',' ')}</strong></summary><p>{watch.why}</p><p>Last checked {time(watch.checkedAt)} · investment outcome unverified</p>{watch.blockNumber&&<p>Block {BigInt(watch.blockNumber).toString()} · {watch.confirmations} L2 confirmations</p>}<a href={`${CHAIN.explorer}/tx/${watch.hash}`} target="_blank" rel="noreferrer">Inspect transaction ↗</a><button className="ws-recheck" disabled={busy} onClick={()=>action('watch',watch.id)}><RefreshCw size={14}/>Recheck</button><button className="ws-recheck" disabled={busy} onClick={()=>action('remove',watch.id)}><Trash2 size={14}/>Remove watch</button></details>)}
      <p className="ws-chain-note">Up to five watches. The runner refreshes at most three per wake, ordered by oldest check. Missing or failed RPC responses remain unresolved and never release spending budgets.</p></div>
    {error&&<p className="ws-error" role="alert">{error}</p>}{message&&<p className="ws-chain-brief" role="status">{message}</p>}
  </div>;
}
