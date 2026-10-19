'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowDownLeft,ArrowUpRight,ChevronDown,X} from 'lucide-react';
import type {WalletProvider} from '@/lib/browser-wallet';
import type {Mandate} from '@/lib/decision';
import InstallReview from './install-review';
import OwnershipPanel from './ownership-panel';
import RealOrderPanel from './real-order-panel';
import WalletSetup from './wallet-setup';
import CurrentWalletRecovery from './current-wallet-recovery';
import PortfolioHome from './portfolio-home';

type Sheet='setup'|'buy'|'sell'|'send'|null;
type SetupStep='connect'|'verify'|'review'|'activate';
type Progress={done:number;total:number;next:string;complete:boolean;action:'setup'|'limits'};

export default function WalletOrdersPanel({mandate,onOpenMandate,progress,publicMode}:{mandate:Mandate;onOpenMandate:()=>void;progress:Progress;publicMode:boolean}){
  const [walletProvider,setWalletProvider]=useState<WalletProvider|null>(null);
  const [address,setAddress]=useState('');
  const [verified,setVerified]=useState(false);
  const [sheet,setSheet]=useState<Sheet>(null);
  const [setupStep,setSetupStep]=useState<SetupStep>('connect');
  const [advanced,setAdvanced]=useState(false);
  const dialog=useRef<HTMLDivElement|null>(null),returnFocus=useRef<HTMLElement|null>(null);
  const receiveProvider=useCallback((provider:WalletProvider|null)=>setWalletProvider(()=>provider),[]);
  const receiveAddress=useCallback((next:string)=>{setAddress(next);setSetupStep(current=>!next?'connect':current==='connect'?'verify':current);},[]);
  const receiveVerified=useCallback((ready:boolean)=>{setVerified(ready);if(ready)setSetupStep(current=>current==='verify'?'review':current);},[]);
  const open=(next:Sheet)=>{returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;if(next==='setup')setSetupStep(!address?'connect':!verified?'verify':progress.next==='Activate buying permission'?'activate':'review');setSheet(next);};
  const close=()=>{setSheet(null);requestAnimationFrame(()=>returnFocus.current?.focus());};
  useEffect(()=>{
    const root=document.documentElement;
    if(!sheet){root.classList.remove('ws-v2-scroll-locked');return;}
    root.classList.add('ws-v2-scroll-locked');
    const frame=requestAnimationFrame(()=>dialog.current?.querySelector<HTMLElement>('.ws-v2-sheet-head button')?.focus());
    const keys=(event:KeyboardEvent)=>{
      // The wallet chooser is a separate portal and owns its own focus and Escape key.
      if(document.querySelector('.ws-wallet-dialog[data-state="open"]'))return;
      if(event.key==='Escape'){event.preventDefault();close();return;}
      if(event.key!=='Tab')return;
      const focusable=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary')??[]).filter(item=>item.getClientRects().length>0);
      if(!focusable.length)return;
      const first=focusable[0],last=focusable.at(-1)!;
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',keys);
    const release=()=>root.classList.remove('ws-v2-scroll-locked');
    window.addEventListener('pagehide',release);
    return()=>{cancelAnimationFrame(frame);release();document.removeEventListener('keydown',keys);window.removeEventListener('pagehide',release);};
  },[sheet]);
  const progressAction=()=>progress.action==='limits'?onOpenMandate():open(progress.action);
  return <section id="ws-wallet-orders" className="ws-v2-shell">
    <PortfolioHome address={address} onAction={open} progress={progress} onProgress={progressAction} publicMode={publicMode}/>
    <nav className="ws-v2-action-bar" aria-label="Wallet actions">
      <button type="button" onClick={()=>open('buy')}><ArrowDownLeft size={20}/><span>Buy</span></button>
      <button type="button" onClick={()=>open('sell')}><ArrowUpRight size={20}/><span>Sell</span></button>
      <button type="button" onClick={()=>open('send')}><ArrowUpRight size={20}/><span>Send</span></button>
    </nav>
    <div className="ws-v2-below"><p>{!publicMode&&'Private pilot · '}Real orders require your wallet approval. Stock Tokens cannot be offered or delivered in the United States or to U.S. persons.</p><button type="button" onClick={()=>open('setup')}>Wallet &amp; setup <ChevronDown size={15}/></button></div>
    <div className="ws-v2-backdrop" data-open={!!sheet} onClick={close} aria-hidden="true"/>
    <div className="ws-v2-sheet" data-open={!!sheet} aria-hidden={!sheet} inert={!sheet} ref={dialog} role={sheet?'dialog':undefined} aria-modal={sheet?'true':undefined} aria-label={sheet?`${sheet} in Stock Steward`:undefined}>
      <div className="ws-v2-sheet-grip" aria-hidden="true"/>
      <header className="ws-v2-sheet-head"><div><small>{sheet==='setup'?'WALLET':sheet==='buy'?'PLACE AN ORDER':sheet==='sell'?'EXCHANGE A HOLDING':'MOVE AN ASSET'}</small><h2>{sheet==='setup'?'Set up your wallet':sheet==='buy'?'Buy stock tokens':sheet==='sell'?'Sell for USDG':'Send to your wallet'}</h2></div><button type="button" onClick={close} aria-label="Close sheet"><X size={20}/></button></header>
      <div className="ws-v2-sheet-scroll">
        <div hidden={sheet!=='setup'} className="ws-v2-sheet-content">
          <nav className="ws-v2-setup-stepper" aria-label="Wallet setup steps">{([['connect','Connect'],['verify','Verify'],['review','Review access'],['activate','Activate']] as const).map(([key,label],index)=><button key={key} type="button" aria-current={setupStep===key?'step':undefined} data-complete={(index===0&&!!address)||(index===1&&verified)} onClick={()=>setSetupStep(key)}><span>{index+1}</span>{label}</button>)}</nav>
          <div hidden={setupStep!=='connect'&&setupStep!=='verify'}><WalletSetup onProvider={receiveProvider} onAddress={receiveAddress} onVerified={receiveVerified} disabled={false} view={setupStep==='connect'?'connect':'verify'}/>{setupStep==='connect'&&address&&<button type="button" className="ws-v2-step-next" onClick={()=>setSetupStep('verify')}>Continue to verification</button>}{setupStep==='verify'&&verified&&<button type="button" className="ws-v2-step-next" onClick={()=>setSetupStep('review')}>Review buying access</button>}</div>
          <div hidden={setupStep!=='review'&&setupStep!=='activate'}><InstallReview key={`review-${address}-${mandate.version}`} provider={walletProvider} address={address} policyVersion={mandate.version} onOpenMandate={onOpenMandate} onVerifyWallet={()=>setSetupStep(address?'verify':'connect')} view={setupStep==='activate'?'activate':'review'} onContinue={()=>setSetupStep('activate')} publicMode={publicMode}/></div>
          {setupStep==='review'&&<><button type="button" className="ws-v2-advanced-toggle" onClick={()=>setAdvanced(value=>!value)} aria-expanded={advanced}>Verification details <ChevronDown size={16}/></button>{advanced&&<div className="ws-v2-advanced"><OwnershipPanel address={address} provider={walletProvider}/><a href="/guide#permission">How limits work ↗</a></div>}</>}
        </div>
        <div hidden={sheet!=='buy'} className="ws-v2-sheet-content"><p className="ws-v2-sheet-intro">{publicMode?'Review each real purchase within your saved limits. You approve the exact order in your wallet.':'Real buying is available only in the private pilot. Your limits apply, and you approve the exact order in your wallet.'}</p>{!address&&<button type="button" className="ws-v2-connect-link" onClick={()=>setSheet('setup')}>Connect and verify wallet</button>}<RealOrderPanel key={`orders-${address}-${mandate.version}`} provider={walletProvider} address={address} onOpenMandate={onOpenMandate}/></div>
        <div hidden={sheet!=='sell'&&sheet!=='send'} className="ws-v2-sheet-content"><p className="ws-v2-sheet-intro">{sheet==='send'?'Move a full token balance to your connected owner wallet. Moving a stock token is not a sale.':'Review a fresh quote for your full holding, then approve the exact sale in your wallet.'}</p>{!address&&<button type="button" className="ws-v2-connect-link" onClick={()=>setSheet('setup')}>Connect and verify wallet</button>}<CurrentWalletRecovery key={`funds-${address}-${mandate.version}`} provider={walletProvider} address={address} mandateVersion={mandate.version} flow={sheet==='send'?'send':'sell'}/></div>
      </div>
    </div>
  </section>;
}
