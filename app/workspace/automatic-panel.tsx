'use client';
import {useEffect,useRef,useState} from 'react';
import {Pause,Play,RefreshCw} from 'lucide-react';
import type {Strategy} from '@/lib/strategy';
import type {Mandate} from '@/lib/decision';
import type {AutonomousRule,AutonomousDecision} from '@/lib/autonomous-live';
import {runExecutionMessage} from '@/lib/autonomous-run-status';
import {formatWorkspaceDate} from '@/lib/workspace-date';
import {useWalletSession} from './wallet-session';
import SessionReview from './session-review';
import SessionWalletActions from './session-wallet-actions';
import AutonomyControls from './autonomy-controls';
import AutonomyRehearsal from './autonomy-rehearsal';
import {buyIdeaFromClaim,type BuyIdea} from '@/lib/buy-idea';
type Event={id:string;kind:'proposal'|'auto_started'|'auto_action';status:string;symbol:string;amount_cents:number;detail:string;transaction_hash:string|null;created_at:string;expires_at:string};
type Plan={revision:number;rule:AutonomousRule;enabled:boolean;nextDueAt:string;failures:number};
type Status={availableStrategy?:Strategy|null;stages:{shadow:boolean;approveByNotification:boolean;autoBuy:boolean};notice:string;plan:Plan|null;runs:{id:string;state:string;decision_json:string|null;created_at:string}[];events:Event[]};

const money=(cents:number)=>`$${(cents/100).toFixed(2)}`;
const every=(minutes:number)=>minutes<60?`every ${minutes} min`:minutes===60?'every hour':minutes===1440?'every day':`every ${minutes/60} hours`;
const when=(value:string)=>formatWorkspaceDate(value,{dateStyle:'medium',timeStyle:'short'});
const clock=(value:string)=>formatWorkspaceDate(value,{hour:'numeric',minute:'2-digit'});
const kindName=(kind:string)=>{const text=kind.replaceAll('_',' ');return text.charAt(0).toUpperCase()+text.slice(1);};
function ruleLine(rule:AutonomousRule){
 if(rule.strategy)return `${kindName(rule.strategy.kind)} · ${rule.symbol} · ${money(rule.amountCents)}`;
 return rule.kind==='threshold'?`Buy ${money(rule.amountCents)} of ${rule.symbol} at or below ${money(rule.thresholdCents)}`:`Buy ${money(rule.amountCents)} of ${rule.symbol} on each check`;
}
// The plan pauses itself after three checks in a row could not finish.
const autoPaused=(plan:Plan)=>!plan.enabled&&plan.failures>=3;
const liveIdea=(event:Event,now:number)=>event.kind==='proposal'&&event.status==='proposed'&&Date.parse(event.expires_at)>now;

export default function AutomaticPanel({mandate,onReviewBuy}:{mandate:Mandate;onReviewBuy:(idea:BuyIdea)=>void}){
 const wallet=useWalletSession();
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState(false);
 const [symbol,setSymbol]=useState(mandate.allowedSymbols[0]??'AAPL'),[amount,setAmount]=useState('10'),[threshold,setThreshold]=useState('350'),[kind,setKind]=useState<'scheduled'|'threshold'>('threshold'),[interval,setInterval]=useState('15');
 const ticket=useRef(0);useEffect(()=>()=>{ticket.current++;},[]);
 async function refresh(){const generation=++ticket.current;setBusy(true);setError('');try{const r=await fetch('/api/workspace/automatic',{cache:'no-store'}),body=await r.json() as Status&{error?:string};if(!r.ok)throw Error(body.error??'Status unavailable.');if(ticket.current===generation){setStatus(body);if(body.plan){const saved=body.plan.rule;setSymbol(saved.symbol);setAmount((saved.amountCents/100).toFixed(2));setThreshold((saved.thresholdCents/100).toFixed(2));setKind(saved.kind==='threshold'?'threshold':'scheduled');setInterval(String(saved.intervalMinutes));}}}catch(e){if(ticket.current===generation)setError(e instanceof Error?e.message:'Status unavailable.');}finally{if(ticket.current===generation)setBusy(false);}}
 useEffect(()=>{const timer=window.setTimeout(()=>void refresh(),0);return()=>window.clearTimeout(timer);},[]);
 async function change(action:'save'|'use_strategy'|'pause'|'resume'|'check_now'){
  if(busy)return;const generation=++ticket.current;setBusy(true);setError('');
  try{const cents=(s:string)=>{if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('Use positive amounts with up to two decimal places.');return Math.round(Number(s)*100);};
   const rule:AutonomousRule|undefined=action!=='save'?undefined:{version:(status?.plan?.rule.version??0)+1,symbol,amountCents:cents(amount),kind,intervalMinutes:Number(interval),thresholdCents:cents(threshold)};
   const r=await fetch('/api/workspace/automatic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,strategyVersion:status?.availableStrategy?.version,revision:status?.plan?.revision??0,...(action==='save'?{rule}:{})})}),body=await r.json() as {error?:string};if(!r.ok)throw Error(body.error??'Controls could not be saved.');
   if(ticket.current===generation){setBusy(false);if(action==='save'||action==='use_strategy')setEditing(false);await refresh();}
  }catch(e){if(ticket.current===generation){setError(e instanceof Error?e.message:'Controls unavailable.');setBusy(false);}}
 }
 async function openIdea(event:Event){
  if(busy)return;setBusy(true);setError('');
  try{const response=await fetch('/api/workspace/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'review_proposal',id:`proposal:${event.id}`})});const data=await response.json() as {proposal?:unknown;error?:string};if(!response.ok)throw Error(data.error??'This idea could not open. No order was sent.');const idea=buyIdeaFromClaim(data.proposal);onReviewBuy(idea);}
  catch(cause){
   // Reload first so the stale card moves to Past ideas, then show why it did not open.
   const message=cause instanceof Error?cause.message:'This idea could not open. No order was sent.';
   setBusy(false);await refresh();setError(message);return;
  }
  setBusy(false);
 }
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify({stages:status?.stages,runs:status?.runs??[],events:status?.events??[]},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='stock-steward-strategy-receipts.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

 const plan=status?.plan??null,shadowOn=!!status?.stages.shadow,now=Date.now();
 const ideas=status?.events.filter(event=>liveIdea(event,now))??[];
 const pastIdeas=status?.events.filter(event=>event.kind==='proposal'&&!liveIdea(event,now))??[];
 const actions=status?.events.filter(event=>event.kind!=='proposal')??[];
 const state=!status?'loading':!plan?(shadowOn?'none':'off'):plan.enabled?'running':autoPaused(plan)?'stopped':'paused';
 const headline={loading:error?'Checks status unavailable':'Loading checks…',off:'Background checks are off',none:'No checks set up',running:'Checks running',paused:'Checks paused',stopped:'Checks paused automatically'}[state];
 const detail=plan?`${ruleLine(plan.rule)} · ${every(plan.rule.intervalMinutes)}${plan.enabled?` · next after ${clock(plan.nextDueAt)}`:''}`:state==='none'?'Save a rule below. It starts paused.':state==='off'?'Practice and your saved rules still work.':'';
 const showForm=shadowOn&&!plan?.rule.strategy&&(!plan||editing);

 return <>
  <section className="ws-checks-bar" data-state={state} aria-label="Background checks status" aria-live="polite">
   <span className="ws-checks-dot" aria-hidden="true"/>
   <div className="ws-checks-text"><strong>{headline}</strong>{detail&&<small>{detail}</small>}{state==='stopped'&&<small>Three checks in a row could not finish. Start again when ready.</small>}</div>
   {plan?<button type="button" className={plan.enabled?'ws-action-secondary':'ws-action-primary'} disabled={busy||(!plan.enabled&&!shadowOn)} onClick={()=>void change(plan.enabled?'pause':'resume')}>{plan.enabled?<><Pause size={15} aria-hidden="true"/> Pause checks</>:<><Play size={15} aria-hidden="true"/> Start checks</>}</button>
    :state==='none'&&<button type="button" className="ws-action-secondary" onClick={()=>document.getElementById('ws-shadow-plan')?.scrollIntoView({behavior:'smooth',block:'start'})}>Set up checks</button>}
  </section>

  <section className="ws-shadow" aria-busy={busy}>
   <header className="ws-shadow-head"><span className="ws-label">BACKGROUND CHECKS · NO SPENDING</span><h3>Your rule, checked for you.</h3><p>Checks never buy. A passing check can leave an idea; you review it in Buy and sign in your wallet.</p></header>
   {error&&<p className="ws-error" role="alert">{error}{!status&&<> <button type="button" className="ws-recheck" onClick={()=>void refresh()}>Retry</button></>}</p>}

   <article className="ws-shadow-card" id="ws-shadow-plan">
    <div className="ws-shadow-card-head"><h4>Rule plan</h4><button type="button" className="ws-icon-button" disabled={busy} onClick={()=>void refresh()} aria-label="Refresh checks status"><RefreshCw size={15} aria-hidden="true"/></button></div>
    {!status&&!error&&<p className="ws-muted" role="status">Loading…</p>}
    {plan&&!editing&&<dl className="ws-shadow-facts">
     <div><dt>Rule</dt><dd>{ruleLine(plan.rule)}</dd></div>
     <div><dt>Checks</dt><dd>{kindName(every(plan.rule.intervalMinutes))}</dd></div>
     <div><dt>Status</dt><dd>{plan.enabled?'Running':'Paused'}</dd></div>
    </dl>}
    {plan&&!editing&&<div className="ws-shadow-actions">
     {plan.enabled&&<button type="button" className="ws-action-secondary" disabled={busy} onClick={()=>void change('check_now')}>Run a check now</button>}
     {shadowOn&&!plan.rule.strategy&&<button type="button" className="ws-action-quiet" disabled={busy} onClick={()=>setEditing(true)}>Edit rule</button>}
    </div>}
    {plan?.rule.strategy&&!editing&&<p className="ws-muted">Uses your Practice strategy. Change it above, then copy it here again.</p>}
    {showForm&&<form className="ws-shadow-form" onSubmit={event=>{event.preventDefault();void change('save');}}>
     <label>Stock<select value={symbol} disabled={busy} onChange={e=>setSymbol(e.target.value)}>{mandate.allowedSymbols.map(s=><option key={s}>{s}</option>)}</select></label>
     <label>Amount · USD<input value={amount} inputMode="decimal" disabled={busy} onChange={e=>setAmount(e.target.value)}/></label>
     <label>Rule<select value={kind} disabled={busy} onChange={e=>setKind(e.target.value as typeof kind)}><option value="threshold">Buy below a price</option><option value="scheduled">Buy on a schedule</option></select></label>
     {kind==='threshold'&&<label>Highest price · USD<input value={threshold} inputMode="decimal" disabled={busy} onChange={e=>setThreshold(e.target.value)}/></label>}
     <label>Check<select value={interval} disabled={busy} onChange={e=>setInterval(e.target.value)}>{[15,30,60,240,1440].map(n=><option value={n} key={n}>{kindName(every(n))}</option>)}</select></label>
     <div className="ws-shadow-actions"><button type="submit" className="ws-action-primary" disabled={busy||!mandate.allowedSymbols.length}>Save rule</button>{editing&&<button type="button" className="ws-action-quiet" disabled={busy} onClick={()=>setEditing(false)}>Cancel</button>}</div>
     <small className="ws-muted">{!mandate.allowedSymbols.length?'Save your limits first.':'Saving pauses checks until you start them.'}</small>
    </form>}
    {status&&!shadowOn&&!plan&&<p className="ws-muted">Background checks are off for now.</p>}
    {status?.availableStrategy&&shadowOn&&<div className="ws-shadow-copy"><p>Or check your Practice strategy: <strong>{kindName(status.availableStrategy.kind)} · {money(status.availableStrategy.amountCents)}</strong></p><button type="button" className="ws-action-quiet" disabled={busy} onClick={()=>void change('use_strategy')}>Use it for checks</button></div>}
   </article>

   <article className="ws-shadow-card ws-shadow-ideas" aria-label="Ideas to review">
    <div className="ws-shadow-card-head"><h4>Ideas to review</h4>{ideas.length>0&&<span className="ws-count">{ideas.length}</span>}</div>
    {status&&!ideas.length&&<p className="ws-muted">No ideas right now.{plan?.enabled?' New ones appear here when your rule passes.':''}</p>}
    {ideas.map(event=><div className="ws-idea" key={event.id}><div><strong>{event.symbol} <span>· {money(event.amount_cents)}</span></strong><small>Expires {clock(event.expires_at)}</small></div><button type="button" className="ws-action-primary" disabled={busy} onClick={()=>void openIdea(event)}>Review in Buy</button></div>)}
    {pastIdeas.length>0&&<details className="ws-past-ideas"><summary>Past ideas <span>{pastIdeas.length}</span></summary>{pastIdeas.map(event=><div className="ws-past-idea" key={event.id}><strong>{event.symbol} · {money(event.amount_cents)}</strong><small>{event.status==='proposed'?'Expired':'Opened'} · {when(event.created_at)}</small></div>)}</details>}
   </article>

   {(status?.runs.length??0)>0&&<details className="ws-shadow-card ws-shadow-history"><summary><h4>Recent checks</h4><span className="ws-count">{status!.runs.length}</span></summary>
    {status!.runs.map(run=>{let decision:AutonomousDecision|null=null;try{decision=run.decision_json?JSON.parse(run.decision_json) as AutonomousDecision:null;}catch{}const label=decision?.status==='would_trigger'?'Rule passed':decision?'Held':run.state==='canceled'?'Stopped by pause':run.state;return <details key={run.id} className="ws-run"><summary><span data-passed={decision?.status==='would_trigger'}>{label}</span><small>{when(run.created_at)}</small></summary>{decision?.execution&&<p>{runExecutionMessage(decision.execution)}</p>}{decision?.execution?.hash&&<p>Transaction: <code>{decision.execution.hash}</code></p>}<ul>{decision?.checks.map(check=><li key={check.name} data-passed={check.passed}><strong>{check.passed?'Passed':'Held'} · {check.name}</strong> {check.detail}</li>)}</ul></details>;})}
    <button type="button" className="ws-action-quiet" onClick={download}>Download receipts</button>
   </details>}

   {actions.length>0&&<details className="ws-shadow-card ws-shadow-history"><summary><h4>Automatic actions</h4><span className="ws-count">{actions.length}</span></summary>{actions.map(event=><div className="ws-past-idea" key={event.id}><strong>{event.symbol} · {money(event.amount_cents)}</strong><small>{event.status} · {when(event.created_at)}</small><p className="ws-muted">{event.detail}</p>{event.transaction_hash&&<a href={`https://robinhoodchain.blockscout.com/tx/${event.transaction_hash}`} target="_blank" rel="noreferrer">View transaction</a>}</div>)}</details>}

   {status?.stages.autoBuy&&<div className="ws-auto-setup"><h4>Automatic buying setup</h4><p>Off for your wallet until you explicitly review and sign a separate session permission, approve a fee ceiling, pass independent reviews, and choose Start. Each automatic buy is limited to $1; the two-day permission cannot exceed $5. Pause stops future submissions.</p><SessionReview/><AutonomyControls provider={wallet?.provider??null} address={wallet?.address??''}/><SessionWalletActions provider={wallet?.provider??null} address={wallet?.address??''}/><AutonomyRehearsal/></div>}
  </section>
 </>;
}
