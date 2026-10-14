'use client';

import {useCallback, useState} from 'react';
import {ArrowRight, CirclePause, ShieldCheck} from 'lucide-react';
import type {WalletProvider} from '@/lib/browser-wallet';
import type {Mandate} from '@/lib/decision';
import InstallReview from './install-review';
import OwnershipPanel from './ownership-panel';
import RealOrderPanel from './real-order-panel';
import WalletSetup from './wallet-setup';

export default function WalletOrdersPanel({mandate,onOpenMandate}:{mandate:Mandate;onOpenMandate:()=>void}) {
  const [walletProvider,setWalletProvider]=useState<WalletProvider|null>(null);
  const [address,setAddress]=useState('');
  const receiveProvider=useCallback((provider:WalletProvider|null)=>setWalletProvider(()=>provider),[]);
  const receiveAddress=useCallback((next:string)=>setAddress(next),[]);

  return <section id="ws-wallet-orders" className="ws-check-panel ws-autonomy-panel">
    <div className="ws-account-head"><div><span className="ws-label"><ShieldCheck size={14}/> WALLET, PERMISSION &amp; ORDERS</span>
      <h2>Your trading controls.</h2><p>Use one wallet connection to verify ownership, activate your limits and approve each purchase.</p></div>
      <span className="ws-autonomy-state"><CirclePause size={16}/> Approval required</span></div>
    <p className="ws-chain-note">Mandate v{mandate.version || '—'} · Every real order opens in your wallet for approval.</p>
    <WalletSetup onProvider={receiveProvider} onAddress={receiveAddress} disabled={false}/>
    <InstallReview key={`review-${address}-${mandate.version}`} provider={walletProvider} address={address} policyVersion={mandate.version} onOpenMandate={onOpenMandate}/>
    <RealOrderPanel key={`orders-${address}-${mandate.version}`} provider={walletProvider} address={address} onOpenMandate={onOpenMandate}/>
    <details className="ws-developer-details"><summary>Advanced</summary>
      <details id="ws-ownership" className="ws-next-steps"><summary>Wallet verification records</summary><OwnershipPanel address={address} provider={walletProvider}/></details>
      <details className="ws-next-steps"><summary>How the limits are enforced</summary>
        <p>Your limits are enforced by the permission contract. Local contract tests cover setup, quotas, rejected calls and revocation.</p>
        <div className="ws-chain-tools"><a className="ws-recheck" href="/guide#permission">Read how permission works <ArrowRight size={14}/></a><span>Nothing here signs or spends.</span></div>
      </details>
    </details>
  </section>;
}
