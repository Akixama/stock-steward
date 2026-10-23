'use client';
import { useCallback, useEffect, useState } from 'react';
import type { WalletProvider } from '@/lib/browser-wallet';
import { jsonResponse } from '@/lib/json-response';
import { formatWorkspaceDate } from '@/lib/workspace-date';
import {permissionTimeRemaining} from '@/lib/permission-window';
import { PermissionReview, PermissionReviewBoundary, type PermissionReviewPayload } from './permission-review';

type Kind='renew'|'revoke';
type Attempt={id:string;kind:Kind;state:'prepared'|'submitted'|'unknown'|'confirmed'|'reverted';confirmation?:'confirmed'|'reverted'|'reorged'|null;hash:string|null;safe:string;expiresAt:number};
type Status={safe:string;ownerAddress:string;expiry:number;permissionActive:boolean;
  eligibility:{state:'active'|'soon'|'expired'|'unavailable';mayRenew:boolean;notice:boolean};
  approvals:{tokenRaw:string;permitRaw:string;permitExpiresAt:number};attempt:Attempt|null;
  checks:{label:string;observed?:string;ok:boolean}[]};
type Preview=PermissionReviewPayload;
const endpoint='/api/workspace/permission/maintenance';
const link=(hash:string)=>`https://robinhoodchain.blockscout.com/tx/${hash}`;

export default function PermissionMaintenance({provider,address}:{provider:WalletProvider|null;address:string}){
  const [status,setStatus]=useState<Status|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [clock,setClock]=useState(0);
  const storageKey=`steward-permission-maintenance:${address.toLowerCase()}`;
  const load=useCallback(async()=>{
    if(!address)return;
    const response=await fetch(endpoint,{cache:'no-store'});
    const result=await jsonResponse<Status&{error?:string}>(response,'Permission status failed. Nothing was sent.');
    if(!response.ok)throw Error(result.error??'Permission status unavailable.');
    const cached=localStorage.getItem(storageKey);
    if(result.attempt?.state==='prepared'&&cached){
      try{
        const parsed=JSON.parse(cached) as {id:string;hash:string};
        if(parsed.id===result.attempt.id&&/^0x[0-9a-f]{64}$/i.test(parsed.hash)){
          await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({action:'submitted',id:parsed.id,hash:parsed.hash})});
          const again=await fetch(endpoint,{cache:'no-store'});
          if(again.ok){setStatus(await jsonResponse<Status>(again,'Permission status failed. Nothing was sent.'));setError('');return;}
        }
      }catch{/* Keep the attempt unresolved; never submit another transaction. */}
    }
    if(result.attempt?.state==='confirmed'||result.attempt?.state==='reverted')localStorage.removeItem(storageKey);
    setStatus(previous=>previous?.attempt?.id===result.attempt?.id&&previous?.attempt?.confirmation==='confirmed'&&result.attempt?.state!=='confirmed'&&!result.attempt?.confirmation
      ?{...result,attempt:{...result.attempt!,confirmation:'reorged'}}:result);
    setError('');
  },[address,storageKey]);
  useEffect(()=>{if(!address||preview||busy)return;let active=true;
    const update=()=>void load().catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Permission status unavailable.');});
    update();const timer=setInterval(update,30000);
    return()=>{active=false;clearInterval(timer);};
  },[address,load,preview,busy]);
  useEffect(()=>{const tick=()=>setClock(Date.now());const first=window.setTimeout(tick,0);const timer=window.setInterval(tick,60_000);return()=>{window.clearTimeout(first);window.clearInterval(timer);};},[]);
  async function action(body:Record<string,unknown>){
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const fallback=body.action==='preview'&&body.kind==='renew'
      ? 'Renew review failed, nothing was sent'
      : 'Permission request failed. Check status before trying again.';
    const result=await jsonResponse<Record<string,unknown>&{error?:string}>(response,fallback);
    if(!response.ok)throw Error(result.error??'Permission request unavailable.');
    return result;
  }
  async function review(kind:Kind){
    if(busy)return;setBusy(true);setError('');
    try{setPreview(await action({action:'preview',kind}) as unknown as Preview);}
    catch(cause){setError(cause instanceof Error?cause.message:'Review unavailable.');}
    finally{setBusy(false);}
  }
  async function sign(){
    if(!preview||!provider||busy||!status||address.toLowerCase()!==status.ownerAddress.toLowerCase())return;
    setBusy(true);setError('');
    let id='';
    try{
      const prepared=await action({action:'prepare',kind:preview.kind,expectedDigest:preview.digest,reviewToken:preview.reviewToken}) as
        {id:string;transaction:{from:string;to:string;data:string;value:string};review:Preview['review']};
      id=prepared.id;setPreview(current=>current?{...current,review:prepared.review}:current);await load();
      const hash=await provider.request({method:'eth_sendTransaction',params:[prepared.transaction]}) as string;
      setPreview(null);
      if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('The wallet returned no transaction hash. Check wallet activity before trying again.');
      localStorage.setItem(storageKey,JSON.stringify({id,hash}));
      await action({action:'submitted',id,hash});
      await load();
    }catch(cause){
      if(id)setPreview(null);
      setError(id
        ? 'The wallet request has an unresolved outcome. Check wallet activity and refresh status; do not sign it again. '
          +(cause instanceof Error?cause.message:'')
        : cause instanceof Error?cause.message:'Permission review changed.');
      await load().catch(()=>{});
    }finally{setBusy(false);}
  }
  if(!address)return null;
  const pending=status?.attempt&&['prepared','submitted','unknown'].includes(status.attempt.state)?status.attempt:null;
  const expired=status?.eligibility.state==='expired';
  const revoked=!!status&&status.checks.find(check=>check.label==='Session membership')?.observed==='revoked';
  const title=error?"Can't check right now":pending?'Wallet action pending':revoked?'Buying permission off':expired?'Approval expired, Renew':status?.permissionActive?`Buying is on · expires ${formatWorkspaceDate(status.expiry,{dateStyle:'medium'},'seconds')}`:'Buying permission needs a check';
  return <section className="ws-maintenance" aria-label="Buying permission maintenance">
    <div className="ws-maintenance-head"><div><span>BUYING ACCESS</span><h2>{title}</h2>
      {status&&!error&&!(status.permissionActive&&!pending&&!expired&&!revoked)&&<p>{expired?'The USDG router approval has expired. Refreshing cannot extend it.':`Expires ${formatWorkspaceDate(status.expiry,undefined,'seconds')}${clock?` · ${permissionTimeRemaining(status.expiry,clock)}`:''}`}</p>}
      {!status&&!error&&<p>Checking the existing Steward wallet…</p>}</div>
      <button type="button" onClick={()=>void load().catch(cause=>setError(String(cause)))} disabled={busy}>Refresh status</button></div>
    {status?.eligibility.state==='soon'&&<p role="status">Reminder: this approval expires soon. Renew on the same Steward wallet after the UTC window ends. Renewing early would reset today’s quota, so it stays locked until then.</p>}
    {pending&&<div className="ws-maintenance-pending" role="status"><strong>{pending.confirmation==='confirmed'?'Confirmed now · final in about 15 minutes':pending.confirmation==='reorged'?'Chain changed · outcome unresolved':pending.confirmation==='reverted'?'Failed · waiting to confirm':pending.hash?'Submitted · checking receipt and exact approvals':'Wallet request unresolved'}</strong><p>{pending.hash?'This saved action stays reserved until confirmed. Refresh to check its status; do not send it again.':'No transaction hash was saved. Check your wallet activity before taking another action; nothing will be resent automatically.'}</p>{pending.hash&&<a href={link(pending.hash)} target="_blank" rel="noopener noreferrer">View transaction {pending.hash.slice(0,10)}… ↗</a>}</div>}
    {status?.attempt?.state==='confirmed'&&<p role="status">{status.attempt.kind==='renew'&&status.permissionActive?'Renewal confirmed. Buying permission is active.':status.attempt.kind==='revoke'?'Revocation verified: the role and both approvals are off.':'Transaction confirmed. Refresh the checks before relying on it.'}{status.attempt.hash&&<> <a href={link(status.attempt.hash)} target="_blank" rel="noopener noreferrer">View receipt ↗</a></>}</p>}
    {status?.attempt?.state==='reverted'&&<p role="status">The saved transaction reverted. No renewal or revocation was claimed. <a href={link(status.attempt.hash!)} target="_blank" rel="noopener noreferrer">View receipt ↗</a></p>}
    {!error&&!preview&&!pending&&status&&<div className="ws-maintenance-actions">
      {expired&&!revoked&&<button type="button" onClick={()=>void review('renew')} disabled={busy||!provider||address.toLowerCase()!==status.ownerAddress.toLowerCase()}>Renew on this wallet</button>}
      {(status.permissionActive||BigInt(status.approvals.tokenRaw)>0n||BigInt(status.approvals.permitRaw)>0n)&&<button type="button" onClick={()=>void review('revoke')} disabled={busy||!provider||address.toLowerCase()!==status.ownerAddress.toLowerCase()}>Revoke and clear approvals</button>}
    </div>}
    {preview&&<PermissionReviewBoundary key={preview.digest} fallback={preview.kind==='renew'?'Renew review failed, nothing was sent':'Review failed, nothing was sent'}>
      <PermissionReview preview={preview} busy={busy} hasProvider={!!provider} onConfirm={()=>void sign()} onCancel={()=>setPreview(null)}/>
    </PermissionReviewBoundary>}
    {error&&<p role="alert" className="ws-error">{error}</p>}
  </section>;
}
