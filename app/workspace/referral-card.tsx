'use client';
import {useEffect,useState} from 'react';
import {Copy,Check,Trophy} from 'lucide-react';
import {SIGNUP_POINTS,VERIFIED_POINTS} from '@/lib/referral';
type Row={rank:number;name:string;points:number;you?:boolean};
type Summary={code:string;link:string;displayName:string|null;signups:number;verified:number;points:number;rank:number|null;top:Row[]};

export default function ReferralCard(){
 const [data,setData]=useState<Summary|null>(null),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 const [name,setName]=useState(''),[editing,setEditing]=useState(false),[saving,setSaving]=useState(false),[nameError,setNameError]=useState('');
 useEffect(()=>{let live=true;fetch('/api/workspace/referrals',{cache:'no-store'}).then(async r=>{const body=await r.json() as Summary&{error?:string};if(!r.ok)throw Error(body.error);if(live){setData(body);setName(body.displayName??'');}}).catch(e=>{if(live)setError(e instanceof Error?e.message:'Referrals are unavailable.');});return()=>{live=false;};},[]);
 async function copy(){if(!data)return;try{await navigator.clipboard.writeText(data.link);setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{/* Clipboard blocked; the link is still visible. */}}
 async function saveName(){setSaving(true);setNameError('');try{const r=await fetch('/api/workspace/referrals',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name.trim()})});const body=await r.json() as {displayName:string|null;error?:string};if(!r.ok)throw Error(body.error);setData(d=>d?{...d,displayName:body.displayName}:d);setEditing(false);}catch(e){setNameError(e instanceof Error?e.message:'Could not save.');}finally{setSaving(false);}}
 if(error)return <section className="ws-referral" aria-label="Invite friends"><p className="ws-muted">{error}</p></section>;
 if(!data)return <section className="ws-referral" aria-label="Invite friends"><p className="ws-muted" role="status">Loading your invite link…</p></section>;
 return <section className="ws-referral" aria-label="Invite friends">
  <div className="ws-referral-head"><div><span className="ws-label">INVITE FRIENDS · EARN POINTS</span><h3>Share Stock Steward. Climb the board.</h3><p>{SIGNUP_POINTS} points when a friend signs up with your link, {VERIFIED_POINTS} more when they verify a wallet.</p></div><Trophy size={26} aria-hidden="true"/></div>
  <div className="ws-referral-link"><code>{data.link}</code><button type="button" className="ws-action-primary" onClick={copy}>{copied?<><Check size={15}/> Copied</>:<><Copy size={15}/> Copy link</>}</button></div>
  <dl className="ws-referral-stats"><div><dt>Points</dt><dd>{data.points.toLocaleString('en-US')}</dd></div><div><dt>Signed up</dt><dd>{data.signups}</dd></div><div><dt>Verified</dt><dd>{data.verified}</dd></div><div><dt>Rank</dt><dd>{data.rank?`#${data.rank}`:'—'}</dd></div></dl>
  <div className="ws-referral-name">{editing?<><label>Name on the leaderboard<input value={name} maxLength={20} onChange={e=>setName(e.target.value)} placeholder={`Steward ${data.code.slice(0,4)}`}/></label><button type="button" className="ws-action-secondary" disabled={saving} onClick={saveName}>{saving?'Saving…':'Save'}</button><button type="button" className="ws-action-quiet" onClick={()=>{setEditing(false);setName(data.displayName??'');setNameError('');}}>Cancel</button>{nameError&&<small className="ws-error" role="alert">{nameError}</small>}</>
   :<><span>Shown on the leaderboard as <strong>{data.displayName??`Steward ${data.code.slice(0,4)}`}</strong></span><button type="button" className="ws-action-quiet" onClick={()=>setEditing(true)}>Change name</button></>}</div>
  {data.top.length>0&&<ol className="ws-referral-top">{data.top.map(row=><li key={row.rank} data-you={row.you?'true':undefined}><span>#{row.rank}</span><strong>{row.name}</strong><span>{row.points.toLocaleString('en-US')} pts</span></li>)}</ol>}
  <a className="ws-referral-board" href="/leaderboard">See the full leaderboard →</a>
 </section>;
}
