'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ShieldCheck,Pause,Play,Ban} from 'lucide-react';
import {matchingWallet,type WalletProvider} from '@/lib/browser-wallet';
import {formatWorkspaceDate} from '@/lib/workspace-date';
import PanicGuardCard from './panic-guard-card';
import StressTestCard from './stress-test-card';
import {V3_EXTRAS} from '@/lib/product-flags';
import GasCard from './gas-card';

type Grant={id:string;state:string;policy:{inputRaw:string;dailyRaw:string;totalRaw:string;expiresAt:number;outputs:{token:string}[];sales?:{token:string}[]};transaction:{from:string;to:string;data:string;value:string}};
type Status={grant:Grant|null;signerStorageConfigured:boolean};
const usd=(raw:string)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(BigInt(raw))/1e6);
const PENDING='steward-auto-install';

// One signature turns automatic trading on: choose, read, sign, done.
export default function AutoSetup({provider,address}:{provider:WalletProvider|null;address:string}){
 const [status,setStatus]=useState<Status|null>(null),[armed,setArmed]=useState<string>('not_started');
 const [days,setDays]=useState(7),[fee,setFee]=useState('0.50');
 const [busy,setBusy]=useState(false),[step,setStep]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const live=useRef(true);useEffect(()=>()=>{live.current=false;},[]);
 const refresh=useCallback(async()=>{
  const [s,c]=await Promise.all([fetch('/api/workspace/autonomy/session',{cache:'no-store'}),fetch('/api/workspace/autonomy/controls',{cache:'no-store'})]);
  const sb=await s.json() as Status&{error?:string},cb=await c.json() as {activationState?:string};
  if(!s.ok)throw Error(sb.error??'Automatic setup is unavailable.');
  if(live.current){setStatus(sb);setArmed(cb.activationState??'not_started');}
  return sb;
 },[]);
 const verify=useCallback(async(grantId:string,hash:string)=>{
  setStep('Waiting for your transaction to confirm on Robinhood Chain…');
  for(let attempt=0;attempt<12&&live.current;attempt++){
   await new Promise(r=>setTimeout(r,attempt?15000:8000));
   const r=await fetch('/api/workspace/autonomy/session/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',id:grantId,grantTx:hash})});
   const b=await r.json() as {verified?:boolean;armed?:boolean;error?:string;notice?:string};
   if(r.ok&&b.verified){try{localStorage.removeItem(PENDING);}catch{}setStep('');setNotice(b.armed?'Done. Steward can now trade for you within your Limits.':'Permission verified.');await refresh();return;}
   if(r.status!==429&&r.status!==422)throw Error(b.error??'Verification failed.');
  }
  throw Error('Still waiting for confirmation. Reopen this page in a minute; your transaction is not lost.');
 },[refresh]);
 useEffect(()=>{let pending:{id:string;hash:string}|null=null;try{pending=JSON.parse(localStorage.getItem(PENDING)??'null');}catch{}
  refresh().then(s=>{if(pending&&s.grant?.id===pending.id&&s.grant.state==='draft'){setBusy(true);verify(pending.id,pending.hash).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}).catch(e=>setError(e instanceof Error?e.message:'Unavailable.'));
 },[refresh,verify]);

 async function run(task:()=>Promise<void>){if(busy)return;setBusy(true);setError('');setNotice('');try{await task();}catch(e){setError(e instanceof Error?e.message:'Something went wrong. Nothing was sent.');setStep('');}finally{setBusy(false);}}
 const prepare=()=>run(async()=>{
  const cents=Math.round(Number(fee)*100);if(!/^\d{1,2}(\.\d{1,2})?$/.test(fee)||cents<1||cents>1000)throw Error('Network fee limit must be $0.01 to $10.');
  const r=await fetch('/api/workspace/autonomy/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'draft',days,maxFeeCents:cents})});
  const b=await r.json() as {error?:string};if(!r.ok)throw Error(b.error??'Could not prepare the permission.');await refresh();
 });
 const sign=()=>run(async()=>{
  const g=status?.grant;if(!provider||!g||g.state!=='draft')throw Error('Connect your wallet first.');
  if(g.transaction.from.toLowerCase()!==address.toLowerCase())throw Error('Switch to the wallet that owns this account.');
  await matchingWallet(provider,address);setStep('Confirm it in your wallet…');
  const hash=await provider.request({method:'eth_sendTransaction',params:[g.transaction]});
  if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Your wallet did not return a transaction. Check its activity before trying again.');
  try{localStorage.setItem(PENDING,JSON.stringify({id:g.id,hash}));}catch{}
  await verify(g.id,hash);
 });
 const control=(action:'pause'|'resume')=>run(async()=>{const r=await fetch('/api/workspace/autonomy/controls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});const b=await r.json() as {error?:string};if(!r.ok)throw Error(b.error??'Unavailable.');setNotice(action==='pause'?'Paused. Steward will not start new trades.':'Resumed.');await refresh();});
 const revoke=()=>run(async()=>{
  if(!provider)throw Error('Connect your wallet first.');await matchingWallet(provider,address);
  const r=await fetch('/api/workspace/autonomy/session/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),b=await r.json() as {transaction:Grant['transaction'];error?:string};if(!r.ok)throw Error(b.error??'Revocation unavailable.');
  setStep('Confirm the removal in your wallet…');await provider.request({method:'eth_sendTransaction',params:[b.transaction]});setStep('');
  setNotice('Trading stopped and the permission removal was sent. It is gone once your wallet transaction confirms.');await refresh();
 });

 const g=status?.grant,p=g?.policy;
 return <section className="ws-auto" aria-busy={busy}>
  <header><ShieldCheck size={22} aria-hidden="true"/><div><span className="ws-label">AUTOMATIC MODE</span><h3>{g?.state==='verified'&&armed==='armed'?'Steward is trading for you.':'One signature. Your rules, enforced on chain.'}</h3></div></header>
  {!status&&!error&&<p className="ws-muted" role="status">Loading…</p>}
  {status&&!g&&<>
   <p>Steward will trade only inside your Limits: the stocks you allowed, your per-buy and per-day amounts. You sign once; the rules are written into your wallet&apos;s permission, so even Stock Steward cannot go past them.</p>
   <div className="ws-auto-choices">
    <label>How long<select value={days} disabled={busy} onChange={e=>setDays(Number(e.target.value))}><option value={2}>2 days</option><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option></select></label>
    <label>Max network fee per trade · USD<input inputMode="decimal" value={fee} disabled={busy} onChange={e=>setFee(e.target.value.trim())}/></label>
   </div>
   <button type="button" className="ws-action-primary" disabled={busy||!status.signerStorageConfigured} onClick={prepare}>Review my permission</button>
   {!status.signerStorageConfigured&&<small className="ws-muted">Automatic mode is not configured on this server yet.</small>}
  </>}
  {g&&p&&<dl className="ws-auto-terms">
   <div><dt>Per trade</dt><dd>up to {usd(p.inputRaw)}</dd></div>
   <div><dt>Per day</dt><dd>up to {usd(p.dailyRaw)}</dd></div>
   <div><dt>In total</dt><dd>never more than {usd(p.totalRaw)}</dd></div>
   <div><dt>Until</dt><dd>{formatWorkspaceDate(new Date(p.expiresAt*1000).toISOString(),{dateStyle:'medium',timeStyle:'short'})}</dd></div>
   <div><dt>Stocks</dt><dd>{p.outputs.length} from your Limits{p.sales?.length?' · plus 1 sale for your sell rule':''}</dd></div>
   <div><dt>Can never</dt><dd>send money out of your wallet, or trade anything else</dd></div>
  </dl>}
  {g?.state==='draft'&&<><p className="ws-auto-risk"><strong>Real money, no signature per trade.</strong> Stock Steward has not had an outside security review. Only use money you can afford to lose.</p><button type="button" className="ws-action-primary" disabled={busy||!provider} onClick={sign}>Sign once in your wallet</button></>}
  {g?.state==='verified'&&<div className="ws-auto-controls">
   {armed==='armed'?<button type="button" className="ws-action-secondary" disabled={busy} onClick={()=>control('pause')}><Pause size={15} aria-hidden="true"/> Pause</button>:<button type="button" className="ws-action-primary" disabled={busy} onClick={()=>control('resume')}><Play size={15} aria-hidden="true"/> Resume</button>}
   <button type="button" className="ws-action-quiet" disabled={busy||!provider} onClick={revoke}><Ban size={15} aria-hidden="true"/> Remove permission</button>
  </div>}
  {g&&['paused','revoked','retired'].includes(g.state)&&<p className="ws-muted">This permission is {g.state}. Remove it, then set up a new one.</p>}
  {g?.state==='verified'&&<GasCard provider={provider} address={address}/>}
  <PanicGuardCard/>
  {V3_EXTRAS&&<StressTestCard/>}
  {step&&<p role="status" className="ws-auto-step">{step}</p>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="ws-error">{error}</p>}
 </section>;
}
