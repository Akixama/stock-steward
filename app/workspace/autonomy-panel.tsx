'use client';
import type {WalletProvider} from '@/lib/browser-wallet';
import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, ArrowRight, CirclePause, RotateCw } from 'lucide-react';
import type { AutonomyReceipt } from '@/lib/autonomy';
import type { Mandate } from '@/lib/decision';
import MonitorPanel from './monitor-panel';
import RoutePanel,{RouteDetails} from './route-panel';
import OwnershipPanel from './ownership-panel';
import WalletSetup from './wallet-setup';
import InstallReview from './install-review';
import RealOrderPanel from './real-order-panel';
import SettlementDetails from './settlement-details';
import WalletProfileDetails from './wallet-profile-details';
export default function AutonomyPanel({mandate,onOpenMandate}:{mandate:Mandate;onOpenMandate:()=>void}) {
  const [walletProvider,setWalletProvider]=useState<WalletProvider|null>(null);
  const [address,setAddress]=useState(''); const [runs,setRuns]=useState<AutonomyReceipt[]>([]);
  const [active,setActive]=useState<AutonomyReceipt|null>(null); const [busy,setBusy]=useState(false);
  const [error,setError]=useState(''); const ticket=useRef(0);
  useEffect(()=>()=>{ticket.current++;},[]);
  function exportEvidence(){if(!active)return;const payload={schema:'stock-steward-readiness-export-v1',exportedAt:new Date().toISOString(),notice:'Historical readiness evidence. No transaction was prepared or submitted. Public wallet addresses and balances may be included.',receipt:active};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='stock-steward-readiness-'+active.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  async function check(run=false) {
    const version=++ticket.current;setBusy(true);setError('');
    try {
      const response=await fetch('/api/workspace/autonomy',run ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address})} : {cache:'no-store'});
      const data=await response.json() as {receipt?:AutonomyReceipt;runs?:AutonomyReceipt[];error?:string};
      if (!response.ok) throw new Error(data.error ?? 'Check unavailable.');
      if(version!==ticket.current)return;
      if(data.receipt){setActive(data.receipt);setRuns(old=>[data.receipt!,...old].slice(0,20));}
      if(data.runs)setRuns(data.runs);
    }catch(e){if(version===ticket.current)setError(e instanceof Error ? e.message:'Check unavailable.');}
    finally{if(version===ticket.current)setBusy(false);}
  }
  return <section id="ws-autonomy-panel" className="ws-check-panel ws-autonomy-panel">
    <div className="ws-account-head"><div><span className="ws-label"><ShieldCheck size={14}/> PERMISSION & ORDERS</span>
      <h2>Turn it on. Then buy.</h2><p>Verify your wallet, turn on the permission, fund it, place orders. You sign everything.</p></div>
      <span className="ws-autonomy-state"><CirclePause size={16}/> Execution inactive</span></div>
    <p className="ws-chain-note">Saved mandate v{mandate.version || '—'} · {mandate.executionPreference==='automatic' ? 'Automatic selected':'Approval selected'}. This page never spends on its own.</p>
    <WalletSetup onProvider={provider=>setWalletProvider(()=>provider)} disabled={busy} onAddress={next=>{ticket.current++;setAddress(next);setActive(null);setBusy(false);setError('');}}/>
    <details className="ws-next-steps"><summary>Check what is ready (optional)</summary>
      <p>Read-only checks against an address. Nothing here signs or spends.</p>
    <div className="ws-check-fields"><label>Wallet address<input value={address} disabled={busy} placeholder="0x…" spellCheck={false} onChange={e=>{setAddress(e.target.value.trim());setActive(null);}}/></label>
      <button onClick={()=>check(true)} disabled={busy || !/^0x[0-9a-f]{40}$/i.test(address)}>{busy ? 'Checking…':'Check what is ready'} <ArrowRight size={16}/></button></div>
    <div className="ws-chain-tools"><button className="ws-recheck" disabled={busy} onClick={()=>check()}><RotateCw size={14}/> Load readiness history</button><span>No signature, wallet grant or transaction. Shared 15-second read cooldown.</span></div>
    {error && <p className="ws-error" role="alert">{error}</p>}
    {active && <div className="ws-autonomy-result" key={active.id}><div className="ws-chain-brief"><strong>Blocked · no spending occurred</strong><p>{active.why}</p><small>Checked {new Date(active.createdAt).toLocaleString()} · mandate v{active.policyVersion ?? '—'}. This is a historical readiness record, not a trading decision.</small></div>
      <div className="ws-chain-tools"><button type="button" className="ws-recheck" onClick={exportEvidence}>Download evidence receipt</button><span>Includes public address and recorded evidence. Review before sharing.</span></div>
      <details className="ws-next-steps"><summary>What still needs to be completed · {active.checks.filter(c=>c.state!=='pass').length} checks</summary><p>This is a historical checklist. Recheck after a change; a passing infrastructure check alone cannot enable spending.</p><ol>{active.checks.filter(c=>c.state!=='pass').map(c=><li key={c.name}><strong>{c.name}</strong><p>{c.reason}</p></li>)}</ol></details>
      {active.checks.map(item=><div className={`ws-receipt-check ws-partial-${item.state}`} key={item.name}><b>{item.state.toUpperCase()}</b><span><strong>{item.name}</strong><small>{item.reason}</small></span></div>)}
      <details><summary>Inspect infrastructure evidence</summary><p>Receipt {active.id}</p><p>Address {active.address} · {active.checks.some(c=>c.name==='Historical wallet control'&&c.state==='pass')?'historical control signature verified; no spending grant':'ownership unverified'}</p>{active.infrastructure ? <><p>Chain {active.infrastructure.chainId} · block {BigInt(active.infrastructure.block).toString()}</p><p>Full network cost is shown in dollars in the activation review below · not estimated here</p>{Object.entries(active.infrastructure.contracts).map(([name,bytes])=><p key={name}>{name}: {bytes} bytes of code at the observed block</p>)}</> : <p>RPC evidence unavailable. No zero balances or liquidity conclusions were inferred.</p>}</details></div>}
    {runs.length>0 && <details className="ws-chain-history"><summary>Saved checks · latest {runs.length}</summary>{runs.map(run=><div key={run.id}><span>{run.address.slice(0,6)}…{run.address.slice(-4)} · {new Date(run.createdAt).toLocaleString()} · {run.trigger==='scheduled'?'scheduled · ':''}blocked</span><button className="ws-recheck" onClick={()=>{setActive(run);setAddress(run.address);}}>Inspect</button></div>)}</details>}
    </details>
    <div id="ws-ownership"><OwnershipPanel address={address} provider={walletProvider}/></div>
    <InstallReview provider={walletProvider} address={address} policyVersion={mandate.version} onOpenMandate={onOpenMandate}/>
    <RealOrderPanel provider={walletProvider} address={address} />
    <details className="ws-next-steps"><summary>How the limits reach the contracts</summary>
      <p>Passed 44 checks in an isolated local chain: wallet creation, spending quotas, rejected unsafe calls and owner revocation.</p>
      <div className="ws-chain-tools"><a className="ws-recheck" href="/guide#spending-permissions">Read the permission implementation <ArrowRight size={14}/></a><span>Nothing here signs or spends.</span></div>
    </details>
    {active?.walletProfile&&<WalletProfileDetails profile={active.walletProfile}/>}
    {active?.route&&<RouteDetails route={active.route} prerequisites={active.prerequisites} simulation={active.routerSimulation}/>}
    {active?.settlementReview&&<SettlementDetails review={active.settlementReview}/>}
    <details className="ws-next-steps"><summary>Advanced · price routes and background monitoring</summary><p>Route checks and read-only monitoring live here. Nothing here spends or authorizes spending.</p>
    <RoutePanel address={address} onSaved={receipt=>{setActive(receipt);setRuns(old=>[receipt,...old].slice(0,20));}}/>
    <MonitorPanel address={address}/></details>
  </section>;
}
