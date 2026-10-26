'use client';
import {useEffect,useState} from 'react';
import {Bot} from 'lucide-react';
type Decision={action:'buy'|'sell'|'hold';symbol:string|null;amountCents:number;reason:string;at:string;blocked?:string};
type Settings={version:1;symbols:string[];style:'careful'|'balanced'|'bold';intervalMinutes:15|30|60|240;note:string};
type Status={available:boolean;settings:Settings|null;enabled:boolean;nextRunAt:string|null;armed:boolean;allowed:string[];lotCents:number;dailyCents:number;saleCount:number;log:Decision[];error?:string};
const money=(c:number)=>`$${(c/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const when=(iso:string)=>new Date(iso).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const STYLES=[['careful','Careful','Buys only real dips, holds a lot'],['balanced','Balanced','Buys dips, takes profit after runs'],['bold','Bold','Trades more often, never all-in']] as const;
const EVERY=[[15,'15 min'],[30,'30 min'],[60,'1 hour'],[240,'4 hours']] as const;

// The AI decides; the guardrail disposes. Every trade it picks still has to fit
// the Limits, Panic guard, gas and the signed on-chain permission.
export default function AgentCard(){
 const [s,setS]=useState<Status|null>(null),[draft,setDraft]=useState<Settings|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function load(){try{const r=await fetch('/api/workspace/agent',{cache:'no-store'});const b=await r.json() as Status;if(!r.ok)throw Error(b.error);setS(b);setDraft(d=>d??b.settings??{version:1,symbols:b.allowed.slice(0,3),style:'balanced',intervalMinutes:60,note:''});}catch(e){setError(e instanceof Error&&e.message?e.message:'Agent unavailable.');}}
 useEffect(()=>{const t=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(t);},[]);
 async function save(enabled:boolean){if(!draft)return;setBusy(true);setError('');try{const r=await fetch('/api/workspace/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings:draft,enabled})});const b=await r.json() as {error?:string};if(!r.ok)throw Error(b.error??'Could not save.');await load();}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setBusy(false);}}
 if(!s&&!error)return null;
 if(s&&!s.available)return null;
 const toggle=(sym:string)=>setDraft(d=>d&&({...d,symbols:d.symbols.includes(sym)?d.symbols.filter(x=>x!==sym):d.symbols.length<6?[...d.symbols,sym]:d.symbols}));
 const changed=!!s?.settings&&JSON.stringify(s.settings)!==JSON.stringify(draft);
 const headline=!s?.enabled?'Let the AI trade for you.':s.armed?'Your agent is trading.':'Your agent is ready. Sign once below to let it trade.';
 return <section className="ws-agent" aria-label="Steward agent" aria-busy={busy}>
  <header><Bot size={22} aria-hidden="true"/><div><span className="ws-label">STEWARD AGENT</span><h3>{headline}</h3>
   <p>The AI watches your stocks and decides what to buy or sell, and when. It trades {s?money(s.lotCents):''} at a time, at most {s?money(s.dailyCents):''} a day. Every trade it picks still passes your Limits, Panic guard and the permission in your wallet.</p></div>
   {s?.enabled&&<span className="ws-agent-dot" data-on={s.armed} aria-hidden="true"/>}</header>
  {error&&<p className="ws-error" role="alert">{error}</p>}
  {s&&draft&&<>
   <fieldset><legend>Stocks it can trade</legend><div className="ws-agent-chips">{s.allowed.map(sym=><button type="button" key={sym} aria-pressed={draft.symbols.includes(sym)} onClick={()=>toggle(sym)}>{sym}</button>)}</div>{!s.allowed.length&&<small className="ws-muted">Add stocks to your Limits first.</small>}</fieldset>
   <fieldset><legend>Style</legend><div className="ws-agent-styles">{STYLES.map(([v,l,d])=><button type="button" key={v} aria-pressed={draft.style===v} onClick={()=>setDraft({...draft,style:v})}><strong>{l}</strong><small>{d}</small></button>)}</div></fieldset>
   <fieldset><legend>Checks every</legend><div className="ws-agent-chips">{EVERY.map(([v,l])=><button type="button" key={v} aria-pressed={draft.intervalMinutes===v} onClick={()=>setDraft({...draft,intervalMinutes:v})}>{l}</button>)}</div></fieldset>
   <label className="ws-agent-note"><span>Tell your agent (optional)</span><textarea maxLength={280} rows={2} placeholder="e.g. Focus on NVDA, never sell at a loss" value={draft.note} onChange={e=>setDraft({...draft,note:e.target.value})}/></label>
   <div className="ws-agent-actions">
    {!s.enabled?<button type="button" className="ws-action-primary" disabled={busy||!draft.symbols.length} onClick={()=>void save(true)}>Turn on agent</button>
     :<><button type="button" className="ws-action-secondary" disabled={busy} onClick={()=>void save(false)}>Turn off</button>{changed&&<button type="button" className="ws-action-primary" disabled={busy||!draft.symbols.length} onClick={()=>void save(true)}>Save changes</button>}</>}
   </div>
   {s.enabled&&!s.armed&&<p className="ws-agent-hint">To let it trade, set up <a href="#ws-auto-setup">Automatic mode</a> below with one signature. Set it up after choosing stocks so the permission includes selling them.</p>}
   {s.enabled&&s.armed&&s.saleCount===0&&<p className="ws-agent-hint">This permission has no sales, so the agent can only buy. Set up Automatic mode again to let it sell too.</p>}
   {s.log.length>0&&<details className="ws-agent-log" open><summary>What your agent decided</summary><ul>{s.log.map(d=><li key={d.at} data-action={d.blocked?'blocked':d.action}>
    <strong>{d.action==='hold'?(d.blocked?`Held${d.symbol?` ${d.symbol}`:''}`:'Held'):`${d.action==='buy'?'Buy':'Sell'} ${money(d.amountCents)} of ${d.symbol}`}</strong><small>{when(d.at)}</small>
    <p>{d.reason}</p>{d.blocked&&<p className="ws-agent-blocked">Guardrail: {d.blocked}.</p>}
   </li>)}</ul></details>}
   <small className="ws-muted">An AI makes these calls, and it can be wrong. Real money, small amounts first. Turning it off stops new decisions at once.</small>
  </>}
 </section>;
}
