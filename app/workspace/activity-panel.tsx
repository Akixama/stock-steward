'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight} from 'lucide-react';
import {formatWorkspaceDate} from '@/lib/workspace-date';
import {activityStateLabel,type ActivityItem} from '@/db/activity';
import PracticeTrail from './practice-trail';

const KIND={buy:'Buy',sell:'Sell',send:'Send',idea:'Idea'} as const;
const money=(cents:number)=>`$${(cents/100).toFixed(2)}`;

// Real wallet receipts first; practice decisions stay folded below.
export default function ActivityPanel({mandateVersion,onLimits,onStrategy,onPractice}:{mandateVersion:number;onLimits:()=>void;onStrategy:()=>void;onPractice:()=>void}){
 const [items,setItems]=useState<ActivityItem[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;void (async()=>{try{const response=await fetch('/api/workspace/activity',{cache:'no-store'});const data=await response.json() as {items?:ActivityItem[];error?:string};if(!response.ok||!data.items)throw Error(data.error??'Activity could not load.');if(active)setItems(data.items);}catch(cause){if(active)setError(cause instanceof Error?cause.message:'Activity could not load.');}})();return()=>{active=false;};},[]);
 return <div className="ws-activity">
  <article className="ws-alert-card ws-activity-card" aria-label="Real activity">
   <div className="ws-alert-card-head"><div><h3>Wallet activity</h3><small>Buys, sales, sends and ideas from your real wallet.</small></div>{items&&items.length>0&&<span className="ws-count">{items.length}</span>}</div>
   {error&&<p className="ws-error" role="alert">{error}</p>}
   {!items&&!error&&<p className="ws-muted" role="status">Loading activity…</p>}
   {items&&!items.length&&<p className="ws-muted">Nothing yet. Your real buys, sales and sends will show here.</p>}
   {items?.map(item=><div className="ws-activity-row" key={item.id} data-kind={item.kind}>
    <span className="ws-activity-kind">{KIND[item.kind]}</span>
    <div><strong>{item.symbol??'Stock'}{item.amountCents!=null&&<span> · {money(item.amountCents)}</span>}</strong><small>{item.state==='expired'?'Expired':activityStateLabel(item.state)} · {formatWorkspaceDate(item.createdAt,{dateStyle:'medium',timeStyle:'short'})}</small></div>
    {item.hash&&<a className="ws-icon-button" href={`https://robinhoodchain.blockscout.com/tx/${item.hash}`} target="_blank" rel="noreferrer" aria-label={`View ${KIND[item.kind]} transaction`}><ArrowUpRight size={16}/></a>}
   </div>)}
  </article>
  <details className="ws-alert-card ws-activity-practice"><summary><h3>Practice decisions</h3><small>Fake-money buys, sales and holds.</small></summary>
   <PracticeTrail mandateVersion={mandateVersion} onLimits={onLimits} onStrategy={onStrategy} onPractice={onPractice}/>
  </details>
 </div>;
}
