'use client';
import {useEffect,useState} from 'react';
import type {PracticeReceipt,PracticeSession} from '@/lib/practice-session';

function Receipt({receipt:r}:{receipt:PracticeReceipt}){
 return <details data-outcome={r.outcome}><summary><strong>{r.outcome==='simulated_fill'?`Practice ${r.side==='sell'?'sale':'purchase'} completed`:r.outcome==='awaiting_approval'?`${r.side==='sell'?'Sale':'Purchase'} needs approval`:r.outcome==='held'?'Agent held':'Declined'}</strong> · {r.symbol} · {(r.amountCents/100).toLocaleString('en-US',{style:'currency',currency:'USD'})}<small>Practice time · {new Date(r.createdAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}</small></summary><p>{r.why}</p><p>Practice {r.side==='sell'?'sell':'buy'} · strategy v{r.strategyVersion} · mandate v{r.mandateVersion}. No real funds or wallet transaction.</p>{r.checks.map(c=><div className="ws-receipt-check" key={c.name}><b data-passed={c.passed}>{c.passed?'PASS':'FAIL'}</b><span><strong>{c.name}</strong><small>{c.detail}</small></span></div>)}</details>;
}

export default function PracticeTrail({onStrategy}:{onStrategy:()=>void}){
 const [session,setSession]=useState<PracticeSession|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function refresh(){setBusy(true);setError('');try{const response=await fetch('/api/workspace/practice',{cache:'no-store'});const data=await response.json() as {session?:PracticeSession;error?:string};if(!response.ok||!data.session)throw Error(data.error??'Practice trail unavailable.');setSession(data.session);}catch(e){setError(e instanceof Error?e.message:'Practice trail unavailable.');}finally{setBusy(false);}}
 useEffect(()=>{void refresh();},[]);
 const decisions=session?.receipts.filter(r=>r.outcome!=='held')??[];
 const holds=session?.receipts.filter(r=>r.outcome==='held')??[];
 return <section className="ws-trail ws-practice-ledger"><div className="ws-account-head"><h2>Practice decisions</h2><div className="ws-action-row"><button className="ws-action-secondary" disabled={busy} onClick={()=>void refresh()}>{busy?'Refreshing…':'Refresh trail'}</button>{!!session?.receipts.length&&<a className="ws-action-secondary" href="/api/workspace/practice?download=1" download="stock-steward-practice.json">Download receipts</a>}</div></div>{error&&<p className="ws-error" role="alert">{error}</p>}{!busy&&!error&&!session?.receipts.length&&<p>No practice decisions yet. Confirm a strategy, authorize practice and run a check.</p>}
 {session&&session.receipts.length>0&&<><p className="ws-trail-summary">{decisions.filter(r=>r.outcome==='simulated_fill'&&r.side!=='sell').length} saved buys · {decisions.filter(r=>r.outcome==='simulated_fill'&&r.side==='sell').length} saved sells · {holds.length} recent holds. Trades and approvals are shown first.</p>{decisions.length>0?<><h3 className="ws-trail-group-title">Trades and approvals</h3><div className="ws-strategy-trail">{decisions.map(r=><Receipt key={r.id} receipt={r}/>)}</div></>:session.priceSource==='market'&&session.account.cashCents<100000?<p className="ws-legacy-valuation">Older purchase receipts from the previous trail limit are unavailable. Your saved fake cash still includes those purchases.</p>:null}{holds.length>0&&<><h3 className="ws-trail-group-title">Recent holds</h3><div className="ws-strategy-trail">{holds.map(r=><Receipt key={r.id} receipt={r}/>)}</div></>}</>}
 <button className="ws-action-secondary" onClick={onStrategy}>Open Practice</button></section>;
}
