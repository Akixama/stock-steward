'use client';
import { useCallback, useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import type { WalletProvider } from '@/lib/browser-wallet';
import { jsonResponse } from '@/lib/json-response';

type Kind='renew'|'revoke';
type Attempt={id:string;kind:Kind;state:'prepared'|'submitted'|'unknown'|'confirmed'|'reverted';hash:string|null;safe:string;expiresAt:number};
type Status={safe:string;ownerAddress:string;expiry:number;permissionActive:boolean;
  eligibility:{state:'active'|'soon'|'expired'|'unavailable';mayRenew:boolean;notice:boolean};
  approvals:{tokenRaw:string;permitRaw:string;permitExpiresAt:number};attempt:Attempt|null;
  checks:{label:string;ok:boolean}[]};
type Review={safe:string;module:string;capRaw:string;spenders:{token:string;permit2:string;router:string};
  expiresAt:number;estimatedNetworkFeeEth:string;revocation:string};
type Preview={kind:Kind;digest:string;review:Review};
const endpoint='/api/workspace/permission/maintenance';
const link=(hash:string)=>`https://robinhoodchain.blockscout.com/tx/${hash}`;
const when=(seconds:number)=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZoneName:'short'}).format(seconds*1000);

export default function PermissionMaintenance({provider,address}:{provider:WalletProvider|null;address:string}){
  const [status,setStatus]=useState<Status|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
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
          if(again.ok){setStatus(await jsonResponse<Status>(again,'Permission status failed. Nothing was sent.'));return;}
        }
      }catch{/* Keep the attempt unresolved; never submit another transaction. */}
    }
    if(result.attempt?.state==='confirmed'||result.attempt?.state==='reverted')localStorage.removeItem(storageKey);
    setStatus(result);
  },[address,storageKey]);
  useEffect(()=>{if(!address)return;let active=true;
    const update=()=>void load().catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Permission status unavailable.');});
    update();const timer=setInterval(update,7000);
    return()=>{active=false;clearInterval(timer);};
  },[address,load]);
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
      const prepared=await action({action:'prepare',kind:preview.kind,expectedDigest:preview.digest}) as
        {id:string;transaction:{from:string;to:string;data:string;value:string}};
      id=prepared.id;setPreview(null);await load();
      const hash=await provider.request({method:'eth_sendTransaction',params:[prepared.transaction]}) as string;
      if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('The wallet returned no transaction hash. Check wallet activity before trying again.');
      localStorage.setItem(storageKey,JSON.stringify({id,hash}));
      await action({action:'submitted',id,hash});
      await load();
    }catch(cause){
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
  const revoked=!!status&&status.checks.find(check=>check.label==='Session membership')?.ok===false;
  const title=pending?'Wallet action pending':revoked?'Buying permission off':expired?'Approval expired, Renew':status?.permissionActive?'Buying permission active':'Buying permission needs a check';
  return <section className="ws-maintenance" aria-label="Buying permission maintenance">
    <div className="ws-maintenance-head"><div><span>BUYING ACCESS</span><h2>{title}</h2>
      {status&&<p>{expired?'The USDG router approval has expired. Refreshing cannot extend it.':`Expires ${when(status.expiry)} · ${new Date(status.expiry*1000).toISOString().replace('.000Z',' UTC')}`}</p>}
      {!status&&!error&&<p>Checking the existing Steward wallet…</p>}</div>
      <button type="button" onClick={()=>void load().catch(cause=>setError(String(cause)))} disabled={busy}>Refresh status</button></div>
    {status?.eligibility.state==='soon'&&<p role="status">Renewal is available after this UTC window ends, so today’s buying limit cannot be reset early.</p>}
    {pending&&<div className="ws-maintenance-pending" role="status"><strong>{pending.hash?'Submitted · waiting for finalized receipt and onchain checks':'Wallet request unresolved'}</strong><p>{pending.hash?'Do not send it again. Refresh to check the saved transaction.':'No transaction hash was saved. Check your wallet activity before taking another action; nothing will be resent automatically.'}</p>{pending.hash&&<a href={link(pending.hash)} target="_blank" rel="noopener noreferrer">View transaction {pending.hash.slice(0,10)}… ↗</a>}</div>}
    {status?.attempt?.state==='confirmed'&&<p role="status">{status.attempt.kind==='renew'&&status.permissionActive?'Renewal verified onchain. Buying permission is active.':status.attempt.kind==='revoke'?'Revocation verified: the role and both approvals are off.':'Transaction confirmed. Refresh the onchain checks before relying on it.'}{status.attempt.hash&&<> <a href={link(status.attempt.hash)} target="_blank" rel="noopener noreferrer">View receipt ↗</a></>}</p>}
    {status?.attempt?.state==='reverted'&&<p role="status">The saved transaction reverted. No renewal or revocation was claimed. <a href={link(status.attempt.hash!)} target="_blank" rel="noopener noreferrer">View receipt ↗</a></p>}
    {!preview&&!pending&&status&&<div className="ws-maintenance-actions">
      {expired&&!revoked&&<button type="button" onClick={()=>void review('renew')} disabled={busy||!provider||address.toLowerCase()!==status.ownerAddress.toLowerCase()}>Renew on this wallet</button>}
      {(status.permissionActive||BigInt(status.approvals.tokenRaw)>0n||BigInt(status.approvals.permitRaw)>0n)&&<button type="button" onClick={()=>void review('revoke')} disabled={busy||!provider||address.toLowerCase()!==status.ownerAddress.toLowerCase()}>Revoke and clear approvals</button>}
    </div>}
    {preview&&<div className="ws-maintenance-review" role="group" aria-label={preview.kind==='renew'?'Renewal review':'Revocation review'}>
      <h3>{preview.kind==='renew'?'Review renewal on the same wallet':'Review revocation'}</h3>
      <dl><div><dt>Steward wallet</dt><dd><code>{preview.review.safe}</code></dd></div>
        <div><dt>{preview.kind==='renew'?'New total USDG cap':'Approvals after revocation'}</dt><dd>{formatUnits(BigInt(preview.review.capRaw),6)} USDG</dd></div>
        <div><dt>USDG token approves</dt><dd>Permit2 <code>{preview.review.spenders.permit2}</code></dd></div>
        <div><dt>Permit2 approves</dt><dd>Trade router <code>{preview.review.spenders.router}</code></dd></div>
        <div><dt>Expiry</dt><dd>{preview.kind==='renew'?when(preview.review.expiresAt):'Approvals cleared now'}</dd></div>
        <div><dt>Estimated network fee</dt><dd>{preview.review.estimatedNetworkFeeEth} ETH · your wallet shows the actual fee</dd></div></dl>
      <p>{preview.review.revocation}</p><p>Approval changes do not transfer funds. Your owner wallet signs the exact Safe transaction once.</p>
      <div><button type="button" onClick={()=>void sign()} disabled={busy||!provider}>{busy?'Checking…':'Confirm exact action in wallet'}</button><button type="button" onClick={()=>setPreview(null)} disabled={busy}>Cancel review</button></div>
    </div>}
    {error&&<p role="alert" className="ws-error">{error}</p>}
  </section>;
}
