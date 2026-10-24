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
import AutoSetup from './auto-setup';
import ReplayCard from './replay-card';
import {buyIdeaFromClaim,type BuyIdea} from '@/lib/buy-idea';
import {isSellKind} from '@/lib/session-sale-lot';
const RULE_KINDS=['scheduled','threshold','sell_below','sell_threshold'] as const;
type RuleKind=typeof RULE_KINDS[number];
const CHECK_OPTIONS=[15,30,60,240,1440];
// Sell rules run through the strategy engine, which checks you hold the stock.
function withStrategy(base:{version:number;symbol:string;amountCents:number;kind:RuleKind;intervalMinutes:number;thresholdCents:number}):AutonomousRule{
 if(!isSellKind(base.kind))return base;
 return {...base,strategy:{version:base.version,kind:base.kind,direction:base.kind==='sell_below'?'Stop-loss':'Take profit',symbol:base.symbol,amountCents:base.amountCents,reserveCents:0,intervalHours:1,thresholdCents:base.thresholdCents,targetBps:5000,driftBps:100,maxMovementBps:100,mode:'automatic'}};
}
type Event={id:string;kind:'proposal'|'auto_started'|'auto_action';status:string;symbol:string;amount_cents:number;detail:string;transaction_hash:string|null;created_at:string;expires_at:string};
type Plan={ruleId:string;revision:number;rule:AutonomousRule;enabled:boolean;nextDueAt:string;failures:number};
type Status={availableStrategy?:Strategy|null;stages:{shadow:boolean;approveByNotification:boolean;autoBuy:boolean};notice:string;plan:Plan|null;plans?:Plan[];maxRules?:number;runs:{id:string;state:string;decision_json:string|null;created_at:string}[];events:Event[]};

const money=(cents:number)=>`$${(cents/100).toFixed(2)}`;
const every=(minutes:number)=>minutes<60?`every ${minutes} minutes`:minutes===60?'every hour':minutes===1440?'once a day':`every ${minutes/60} hours`;
const when=(value:string)=>formatWorkspaceDate(value,{dateStyle:'medium',timeStyle:'short'});
const clock=(value:string)=>formatWorkspaceDate(value,{hour:'numeric',minute:'2-digit'});
const kindName=(kind:string)=>{const text=kind.replaceAll('_',' ');return text.charAt(0).toUpperCase()+text.slice(1);};
function ruleLine(rule:AutonomousRule){
 if(rule.kind==='sell_below')return `Sell ${money(rule.amountCents)} of ${rule.symbol} if it drops to ${money(rule.thresholdCents)} or less`;
 if(rule.kind==='sell_threshold')return `Sell ${money(rule.amountCents)} of ${rule.symbol} when it rises to ${money(rule.thresholdCents)} or more`;
 if(rule.strategy)return `${kindName(rule.strategy.kind)} · ${rule.symbol} · ${money(rule.amountCents)}`;
 return rule.kind==='threshold'?`Buy ${money(rule.amountCents)} of ${rule.symbol} when it drops to ${money(rule.thresholdCents)} or less`:`Buy ${money(rule.amountCents)} of ${rule.symbol} regularly`;
}
// The plan pauses itself after three checks in a row could not finish.
const autoPaused=(plan:Plan)=>!plan.enabled&&plan.failures>=3;
const liveIdea=(event:Event,now:number)=>event.kind==='proposal'&&event.status==='proposed'&&Date.parse(event.expires_at)>now;

export default function AutomaticPanel({mandate,onReviewBuy}:{mandate:Mandate;onReviewBuy:(idea:BuyIdea)=>void}){
 const wallet=useWalletSession();
 const [status,setStatus]=useState<Status|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState<string|null>(null);
 const [symbol,setSymbol]=useState(mandate.allowedSymbols[0]??'AAPL'),[amount,setAmount]=useState('10'),[threshold,setThreshold]=useState('350'),[kind,setKind]=useState<RuleKind>('threshold'),[interval,setInterval]=useState('15');
 const ticket=useRef(0);useEffect(()=>()=>{ticket.current++;},[]);
 async function refresh(){const generation=++ticket.current;setBusy(true);setError('');try{const r=await fetch('/api/workspace/automatic',{cache:'no-store'}),body=await r.json() as Status&{error?:string};if(!r.ok)throw Error(body.error??'Status unavailable.');if(ticket.current===generation)setStatus(body);}catch(e){if(ticket.current===generation)setError(e instanceof Error?e.message:'Status unavailable.');}finally{if(ticket.current===generation)setBusy(false);}}
 useEffect(()=>{const timer=window.setTimeout(()=>void refresh(),0);return()=>window.clearTimeout(timer);},[]);
 function startEdit(plan:Plan|null){
  if(plan){const saved=plan.rule;setSymbol(saved.symbol);setAmount((saved.amountCents/100).toFixed(2));setThreshold((saved.thresholdCents/100).toFixed(2));setKind((RULE_KINDS as readonly string[]).includes(saved.kind)?saved.kind as RuleKind:'scheduled');setInterval(String(saved.intervalMinutes));setEditing(plan.ruleId);}
  else{setSymbol(mandate.allowedSymbols[0]??'AAPL');setAmount('10');setThreshold('350');setKind('threshold');setInterval('15');setEditing('new');}
 }
 async function change(action:'save'|'use_strategy'|'pause'|'resume'|'check_now'|'delete',plan?:Plan|null){
  if(busy)return;const generation=++ticket.current;setBusy(true);setError('');
  try{const cents=(s:string)=>{if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('Use positive amounts with up to two decimal places.');return Math.round(Number(s)*100);};
   const target=action==='save'?(editing==='new'?null:plans.find(p=>p.ruleId===editing)??null):plan??null;
   const ruleId=target?.ruleId??(action==='save'||action==='use_strategy'?(plans.length?`r${crypto.randomUUID().slice(0,8)}`:'main'):'main');
   const base=action!=='save'?undefined:{version:(target?.rule.version??0)+1,symbol,amountCents:cents(amount),kind,intervalMinutes:Number(interval),thresholdCents:kind==='scheduled'?cents(threshold||'1'):cents(threshold)};
   const rule:AutonomousRule|undefined=base?withStrategy(base):undefined;
   const r=await fetch('/api/workspace/automatic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,ruleId,strategyVersion:status?.availableStrategy?.version,revision:target?.revision??0,...(action==='save'?{rule}:{})})}),body=await r.json() as {error?:string};if(!r.ok)throw Error(body.error??'Controls could not be saved.');
   if(ticket.current===generation){setBusy(false);if(action==='save'||action==='use_strategy')setEditing(null);await refresh();}
  }catch(e){if(ticket.current===generation){setError(e instanceof Error?e.message:'Controls unavailable.');setBusy(false);}}
 }
 async function openIdea(event:Event){
  if(busy)return;setBusy(true);setError('');
  try{const response=await fetch('/api/workspace/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'review_proposal',id:`proposal:${event.id}`})});const data=await response.json() as {proposal?:unknown;error?:string};if(!response.ok)throw Error(data.error??'This idea could not open. No order was sent.');const idea=buyIdeaFromClaim(data.proposal);onReviewBuy(idea);}
  catch(cause){
   // Reload first so the stale card moves to Earlier buy ideas, then show why it did not open.
   const message=cause instanceof Error?cause.message:'This idea could not open. No order was sent.';
   setBusy(false);await refresh();setError(message);return;
  }
  setBusy(false);
 }
 function download(){const url=URL.createObjectURL(new Blob([JSON.stringify({stages:status?.stages,runs:status?.runs??[],events:status?.events??[]},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='stock-steward-strategy-receipts.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

 const plans=status?.plans??(status?.plan?[{...status.plan,ruleId:'main'}]:[]),shadowOn=!!status?.stages.shadow,now=Date.now();
 const ideas=status?.events.filter(event=>liveIdea(event,now))??[];
 const pastIdeas=status?.events.filter(event=>event.kind==='proposal'&&!liveIdea(event,now))??[];
 const actions=status?.events.filter(event=>event.kind!=='proposal')??[];
 const watching=plans.filter(p=>p.enabled).length,stopped=plans.some(autoPaused);
 const state=!status?'loading':!plans.length?(shadowOn?'none':'off'):watching?'running':stopped?'stopped':'paused';
 const headline={loading:error?'Could not load':'Loading…',off:'Watching is not available yet',none:'You are not watching a stock yet',running:watching===1?'Watching 1 rule for you':`Watching ${watching} rules for you`,paused:'Watching is paused',stopped:'Watching stopped'}[state];
 const detail=state==='running'?`${plans.length-watching?`${plans.length-watching} paused · `:''}${plans.filter(p=>p.enabled).map(p=>p.rule.symbol).filter((v,i,a)=>a.indexOf(v)===i).join(', ')}`:state==='none'?'Add a rule below to get started.':state==='off'?'You can still buy from Home and practice with fake money.':'';
 const own=(plan:Plan)=>!plan.rule.strategy||isSellKind(plan.rule.kind);
 const max=status?.maxRules??6;

 return <>
  <section className="ws-checks-bar" data-state={state} aria-label="Background checks status" aria-live="polite">
   <span className="ws-checks-dot" aria-hidden="true"/>
   <div className="ws-checks-text"><strong>{headline}</strong>{detail&&<small>{detail}</small>}{state==='stopped'&&<small>A rule could not check prices 3 times in a row. Start it again below.</small>}</div>
   {watching>0&&<button type="button" className="ws-action-secondary" disabled={busy} onClick={()=>void change('check_now')}>Check prices now</button>}
  </section>

  <section className="ws-shadow" aria-busy={busy}>
   <header className="ws-shadow-head"><span className="ws-label">YOUR RULES</span><h3>Tell Steward what to buy and sell.</h3><p>Add up to {max} rules: buy dips, buy regularly, stop-losses and take-profits, on different stocks. Steward watches all of them. When one is right, a buy appears under <strong>Ready to buy</strong> for you to approve, or, with automatic mode on, Steward does it for you.</p></header>
   {error&&<p className="ws-error" role="alert">{error}{!status&&<> <button type="button" className="ws-recheck" onClick={()=>void refresh()}>Retry</button></>}</p>}

   <article className="ws-shadow-card" id="ws-shadow-plan">
    <div className="ws-shadow-card-head"><h4>Rules {plans.length>0&&<span className="ws-count">{plans.length}</span>}</h4><button type="button" className="ws-icon-button" disabled={busy} onClick={()=>void refresh()} aria-label="Refresh"><RefreshCw size={15} aria-hidden="true"/></button></div>
    {!status&&!error&&<p className="ws-muted" role="status">Loading…</p>}
    {plans.length>0&&<ul className="ws-rule-list">{plans.map(plan=><li key={plan.ruleId} data-on={plan.enabled}>
     <div className="ws-rule-main"><span className="ws-rule-side" data-side={isSellKind(plan.rule.kind)?'sell':'buy'}>{isSellKind(plan.rule.kind)?'SELL':'BUY'}</span><div><strong>{ruleLine(plan.rule)}</strong><small>{plan.enabled?`Watching · checks ${every(plan.rule.intervalMinutes)} · next after ${clock(plan.nextDueAt)}`:autoPaused(plan)?'Stopped after 3 failed checks':'Paused'}</small></div></div>
     <div className="ws-rule-actions">
      <button type="button" className={plan.enabled?'ws-action-quiet':'ws-action-secondary'} disabled={busy||(!plan.enabled&&!shadowOn)} onClick={()=>void change(plan.enabled?'pause':'resume',plan)}>{plan.enabled?<><Pause size={14} aria-hidden="true"/> Pause</>:<><Play size={14} aria-hidden="true"/> Start</>}</button>
      {own(plan)&&<button type="button" className="ws-action-quiet" disabled={busy||!shadowOn} onClick={()=>startEdit(plan)}>Change</button>}
      <button type="button" className="ws-action-quiet" disabled={busy} onClick={()=>{if(window.confirm('Remove this rule? Saved receipts stay in your history.'))void change('delete',plan);}}>Remove</button>
     </div>
     {plan.rule.strategy&&!own(plan)&&<small className="ws-muted">From your Practice strategy. Edit it in Practice, then use it again.</small>}
    </li>)}</ul>}
    {editing===null&&shadowOn&&plans.length<max&&<button type="button" className="ws-action-primary ws-add-rule" disabled={busy||!mandate.allowedSymbols.length} onClick={()=>startEdit(null)}>+ Add a rule</button>}
    {editing!==null&&<form className="ws-shadow-form" onSubmit={event=>{event.preventDefault();void change('save');}}>
     <strong className="ws-form-title">{editing==='new'?'New rule':'Change rule'}</strong>
     <label>{isSellKind(kind)?'Stock to sell':'Stock to buy'}<select value={symbol} disabled={busy} onChange={e=>setSymbol(e.target.value)}>{mandate.allowedSymbols.map(s=><option key={s}>{s}</option>)}</select></label>
     <label>{isSellKind(kind)?'How much to sell · USD':'How much to spend · USD'}<input value={amount} inputMode="decimal" disabled={busy} onChange={e=>setAmount(e.target.value)}/></label>
     <label>What to do<select value={kind} disabled={busy} onChange={e=>setKind(e.target.value as RuleKind)}><optgroup label="Buy"><option value="threshold">Buy when the price drops low enough</option><option value="scheduled">Buy regularly, whatever the price</option></optgroup><optgroup label="Sell"><option value="sell_below">Sell if the price drops to (stop-loss)</option><option value="sell_threshold">Sell when the price rises to (take profit)</option></optgroup></select></label>
     {kind!=='scheduled'&&<label>{kind==='threshold'?'Buy at this price or lower · USD':kind==='sell_below'?'Sell at this price or lower · USD':'Sell at this price or higher · USD'}<input value={threshold} inputMode="decimal" disabled={busy} onChange={e=>setThreshold(e.target.value)}/></label>}
     <label>How often to check the price<select value={interval} disabled={busy} onChange={e=>setInterval(e.target.value)}>{CHECK_OPTIONS.map(n=><option value={n} key={n}>{kindName(every(n))}</option>)}</select></label>
     <div className="ws-shadow-actions"><button type="submit" className="ws-action-primary" disabled={busy||!mandate.allowedSymbols.length}>Save rule</button><button type="button" className="ws-action-quiet" disabled={busy} onClick={()=>setEditing(null)}>Cancel</button></div>
     <ReplayCard rule={(()=>{const c=(v:string)=>/^\d+(\.\d{1,2})?$/.test(v)?Math.round(Number(v)*100):NaN;const a=c(amount),t=kind==='scheduled'?1:c(threshold);return Number.isSafeInteger(a)&&a>0&&Number.isSafeInteger(t)&&t>0&&symbol?{kind,symbol,amountCents:a,thresholdCents:t,intervalMinutes:Number(interval)}:null;})()}/>
     <small className="ws-muted">{!mandate.allowedSymbols.length?'Set your limits first.':isSellKind(kind)?'Sell rules act with automatic mode on. Set up (or renew) the permission after saving so it includes this stock.':'New rules start paused. Tap Start when you are ready.'}</small>
    </form>}
    {status&&!shadowOn&&!plans.length&&<p className="ws-muted">Watching a stock is not available yet.</p>}
    {status?.availableStrategy&&shadowOn&&plans.length<max&&editing===null&&<div className="ws-shadow-copy"><p>Or add the strategy you built in Practice: <strong>{kindName(status.availableStrategy.kind)} · {money(status.availableStrategy.amountCents)}</strong></p><button type="button" className="ws-action-quiet" disabled={busy} onClick={()=>void change('use_strategy')}>Add it as a rule</button></div>}
   </article>

   <article className="ws-shadow-card ws-shadow-ideas" aria-label="Ready to buy">
    <div className="ws-shadow-card-head"><h4>Ready to buy</h4>{ideas.length>0&&<span className="ws-count">{ideas.length}</span>}</div>
    {status&&!ideas.length&&<p className="ws-muted">Nothing to buy yet.{watching?' When the price is right, a buy shows up here for you to approve.':''}</p>}
    {ideas.map(event=><div className="ws-idea" key={event.id}><div><strong>{event.symbol} <span>· {money(event.amount_cents)}</span></strong><small>Good until {clock(event.expires_at)}</small></div><button type="button" className="ws-action-primary" disabled={busy} onClick={()=>void openIdea(event)}>Review and buy</button></div>)}
    {pastIdeas.length>0&&<details className="ws-past-ideas"><summary>Earlier buy ideas <span>{pastIdeas.length}</span></summary>{pastIdeas.map(event=><div className="ws-past-idea" key={event.id}><strong>{event.symbol} · {money(event.amount_cents)}</strong><small>{event.status==='proposed'?'Expired':'Opened'} · {when(event.created_at)}</small></div>)}</details>}
   </article>

   {(status?.runs.length??0)>0&&<details className="ws-shadow-card ws-shadow-history"><summary><h4>Price checks</h4><span className="ws-count">{status!.runs.length}</span></summary>
    {status!.runs.map(run=>{let decision:AutonomousDecision|null=null;try{decision=run.decision_json?JSON.parse(run.decision_json) as AutonomousDecision:null;}catch{}const label=decision?.status==='would_trigger'?'Time to buy':decision?'Not yet':run.state==='canceled'?'Stopped by pause':run.state;return <details key={run.id} className="ws-run"><summary><span data-passed={decision?.status==='would_trigger'}>{label}</span><small>{when(run.created_at)}</small></summary>{decision?.execution&&<p>{runExecutionMessage(decision.execution)}</p>}{decision?.execution?.hash&&<p>Transaction: <code>{decision.execution.hash}</code></p>}<ul>{decision?.checks.map(check=><li key={check.name} data-passed={check.passed}><strong>{check.passed?'OK':'Not yet'} · {check.name}</strong> {check.detail}</li>)}</ul></details>;})}
    <button type="button" className="ws-action-quiet" onClick={download}>Download receipts</button>
   </details>}

   {actions.length>0&&<details className="ws-shadow-card ws-shadow-history"><summary><h4>Automatic actions</h4><span className="ws-count">{actions.length}</span></summary>{actions.map(event=><div className="ws-past-idea" key={event.id}><strong>{event.symbol} · {money(event.amount_cents)}</strong><small>{event.status} · {when(event.created_at)}</small><p className="ws-muted">{event.detail}</p>{event.transaction_hash&&<a href={`https://robinhoodchain.blockscout.com/tx/${event.transaction_hash}`} target="_blank" rel="noreferrer">View transaction</a>}</div>)}</details>}

   {status?.stages.autoBuy&&<div className="ws-auto-setup"><h4>Let Steward buy and sell for you</h4><p>When your rule passes, Steward buys or sells on its own, without asking each time. It can only act inside your Limits, and those limits are written into your wallet permission, so they hold even if Stock Steward itself went wrong. Pause stops new trades instantly; removing the permission ends it for good.</p><p className="ws-auto-risk"><strong>Real money, no signature per buy.</strong> Stock Steward has not had an outside security review. Only turn this on with money you can afford to lose.</p><AutoSetup provider={wallet?.provider??null} address={wallet?.address??''}/><details className="ws-auto-advanced"><summary>Advanced tools</summary><SessionReview/><AutonomyControls provider={wallet?.provider??null} address={wallet?.address??''}/><SessionWalletActions provider={wallet?.provider??null} address={wallet?.address??''}/><AutonomyRehearsal/></details></div>}
  </section>
 </>;
}
