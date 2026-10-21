'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowDownLeft,ArrowLeft,ArrowUpRight,ChevronRight,X} from 'lucide-react';
import type {WalletProvider} from '@/lib/browser-wallet';
import type {Mandate} from '@/lib/decision';
import InstallReview from './install-review';
import RealOrderPanel from './real-order-panel';
import WalletSetup from './wallet-setup';
import CurrentWalletRecovery from './current-wallet-recovery';
import PreviousWalletRecovery from './previous-wallet-recovery';
import PortfolioHome from './portfolio-home';
import PermissionMaintenance from './permission-maintenance';

type Sheet='buy'|'sell'|'send'|null;
type SetupStep='connect'|'verify'|'review'|'activate';
type Progress={done:number;total:number;next:string;complete:boolean;action:'setup'|'limits'};
type EarlierWallet={safe:string;mandateVersion:number;usdg:string|null;holdings:{symbol:string;tokens:string|null}[];verified:boolean};
type Asset={symbol:string;quantity:string|null};

export default function WalletOrdersPanel({mandate,onOpenMandate,progress,publicMode}:{mandate:Mandate;onOpenMandate:()=>void;progress:Progress;publicMode:boolean}){
  const [walletProvider,setWalletProvider]=useState<WalletProvider|null>(null);
  const [address,setAddress]=useState('');
  const [verified,setVerified]=useState(false);
  const [sheet,setSheet]=useState<Sheet>(null);
  const [setupStep,setSetupStep]=useState<SetupStep>('connect');
  const [page,setPage]=useState<'overview'|'move-funds'>('overview');
  const [earlierWallet,setEarlierWallet]=useState<EarlierWallet|null>(null);
  const [earlierLoading,setEarlierLoading]=useState(true);
  const [earlierRefresh,setEarlierRefresh]=useState(0);
  const [earlierDismissed,setEarlierDismissed]=useState(false);
  const [sendFrom,setSendFrom]=useState<'current'|'earlier'>('current');
  const [selectedAsset,setSelectedAsset]=useState<Asset|null>(null);
  const dialog=useRef<HTMLDivElement|null>(null),returnFocus=useRef<HTMLElement|null>(null);
  const receiveProvider=useCallback((provider:WalletProvider|null)=>setWalletProvider(()=>provider),[]);
  const receiveAddress=useCallback((next:string)=>{setAddress(next);setSetupStep(current=>!next?'connect':current==='connect'?'verify':current);},[]);
  const receiveVerified=useCallback((ready:boolean)=>{setVerified(ready);if(ready)setSetupStep(current=>current==='verify'?'review':current);},[]);
  const focusSetup=()=>{setPage('overview');requestAnimationFrame(()=>document.getElementById('ws-v3-setup')?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));};
  const open=(next:'setup'|'buy'|'sell'|'send')=>{
    if(next==='setup'){focusSetup();return;}
    returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    if(next==='send'){setSendFrom('current');setSelectedAsset(null);}
    setSheet(next);
  };
  const openEarlierSend=(asset:Asset)=>{setSendFrom('earlier');setSelectedAsset(asset);setSheet('send');};
  const close=()=>{setSheet(null);requestAnimationFrame(()=>returnFocus.current?.focus());};

  useEffect(()=>{const review=()=>{returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setSheet('buy');};window.addEventListener('stock-steward:open-buy',review);return()=>window.removeEventListener('stock-steward:open-buy',review);},[]);

  useEffect(()=>{
    if(mandate.version<2){queueMicrotask(()=>{setEarlierWallet(null);setEarlierLoading(false);});return;}
    const controller=new AbortController();
    void fetch('/api/workspace/wallets/previous',{cache:'no-store',signal:controller.signal})
      .then(async response=>response.ok?response.json() as Promise<{wallet:EarlierWallet|null}>:null)
      .then(result=>{if(!controller.signal.aborted)setEarlierWallet(result?.wallet??null);})
      .catch(()=>{if(!controller.signal.aborted)setEarlierWallet(null);})
      .finally(()=>{if(!controller.signal.aborted)setEarlierLoading(false);});
    return()=>controller.abort();
  },[mandate.version,address,earlierRefresh]);

  useEffect(()=>{
    const root=document.documentElement;
    if(!sheet){root.classList.remove('ws-v2-scroll-locked');return;}
    root.classList.add('ws-v2-scroll-locked');
    const frame=requestAnimationFrame(()=>dialog.current?.querySelector<HTMLElement>('.ws-v2-sheet-head button')?.focus());
    const keys=(event:KeyboardEvent)=>{
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

  const earlierAssets:Asset[]=earlierWallet?[{symbol:'USDG',quantity:earlierWallet.usdg},...earlierWallet.holdings.map(holding=>({symbol:holding.symbol,quantity:holding.tokens}))]:[];
  const visibleAssets=earlierAssets.filter(asset=>asset.quantity===null||Number(asset.quantity)>0);
  const hasEarlier=!!earlierWallet&&earlierWallet.mandateVersion<mandate.version&&visibleAssets.length>0;
  const showSetup=!progress.complete||!address;

  return <section id="ws-wallet-orders" className="ws-v2-shell ws-v3-shell">
    {(page==='move-funds'||!showSetup)&&<div hidden aria-hidden="true"><WalletSetup onProvider={receiveProvider} onAddress={receiveAddress} onVerified={receiveVerified} disabled={false} view="connect"/></div>}
    {page==='overview'?<>
      <PortfolioHome address={address} onAction={open} publicMode={publicMode}/>
      {address&&verified&&<PermissionMaintenance provider={walletProvider} address={address}/>}
      <nav className="ws-v2-action-bar" aria-label="Wallet actions"><button type="button" onClick={()=>open('buy')}><ArrowDownLeft size={20}/><span>Buy</span></button><button type="button" onClick={()=>open('sell')}><ArrowUpRight size={20}/><span>Sell</span></button><button type="button" onClick={()=>open('send')}><ArrowUpRight size={20}/><span>Send</span></button></nav>
      {hasEarlier&&!earlierDismissed&&<aside className="ws-v3-earlier-banner" role="note"><div><span>EARLIER WALLET · VERSION {earlierWallet.mandateVersion}</span><strong>Funds are still in your earlier Steward wallet.</strong><p>{visibleAssets.map(asset=>`${asset.quantity??'Unavailable'} ${asset.symbol}`).join(' · ')}. New buys use your current Steward wallet.</p></div><button type="button" className="ws-v3-banner-action" onClick={()=>setPage('move-funds')}>Review funds <ChevronRight size={17}/></button><button type="button" className="ws-v3-banner-dismiss" onClick={()=>setEarlierDismissed(true)} aria-label="Dismiss earlier wallet notice"><X size={17}/></button></aside>}
      {showSetup&&<section id="ws-v3-setup" className="ws-v3-setup" aria-label="Wallet setup"><header><div><span>WALLET ACCESS</span><h2>{progress.complete?'Reconnect your wallet':'Finish setting up your wallet'}</h2><p>{progress.complete?'Connect your owner wallet to see balances and review actions.':'Connect, verify, review access, then activate. Each wallet approval stays under your control.'}</p></div>{progress.action==='limits'&&!progress.complete&&<button type="button" onClick={onOpenMandate}>Set your limits <ChevronRight size={16}/></button>}</header>
        {!progress.complete&&<nav className="ws-v3-setup-stepper" aria-label="Wallet setup steps">{([['connect','Connect'],['verify','Verify'],['review','Review access'],['activate','Activate']] as const).map(([key,label],index)=><button key={key} type="button" aria-current={setupStep===key?'step':undefined} data-complete={(index===0&&!!address)||(index===1&&verified)} onClick={()=>setSetupStep(key)}><span>{String(index+1).padStart(2,'0')}</span>{label}</button>)}</nav>}
        <div className="ws-v3-setup-content" hidden={!progress.complete&&setupStep!=='connect'&&setupStep!=='verify'}><WalletSetup onProvider={receiveProvider} onAddress={receiveAddress} onVerified={receiveVerified} disabled={false} view={progress.complete||setupStep==='connect'?'connect':'verify'}/>{!progress.complete&&setupStep==='connect'&&address&&<button type="button" className="ws-v2-step-next" onClick={()=>setSetupStep('verify')}>Continue to verification <ChevronRight size={16}/></button>}{!progress.complete&&setupStep==='verify'&&verified&&<button type="button" className="ws-v2-step-next" onClick={()=>setSetupStep('review')}>Review buying access <ChevronRight size={16}/></button>}</div>
        {!progress.complete&&<div className="ws-v3-setup-content" hidden={setupStep!=='review'&&setupStep!=='activate'}><InstallReview key={`review-${address}-${mandate.version}`} provider={walletProvider} address={address} policyVersion={mandate.version} onOpenMandate={onOpenMandate} onVerifyWallet={()=>setSetupStep(address?'verify':'connect')} view={setupStep==='activate'?'activate':'review'} onContinue={()=>setSetupStep('activate')} publicMode={publicMode}/></div>}
      </section>}
      <div className="ws-v2-below"><p>{!publicMode&&'Private pilot · '}Real orders require your wallet approval. Stock Tokens cannot be offered or delivered in the United States or to U.S. persons.</p>{hasEarlier&&<button type="button" onClick={()=>setPage('move-funds')}>Move earlier funds <ChevronRight size={15}/></button>}</div>
    </>:<section className="ws-v3-move-page" aria-label="Move earlier funds"><button type="button" className="ws-v3-back" onClick={()=>setPage('overview')}><ArrowLeft size={17}/> Overview</button><div className="ws-v3-move-head"><span>EARLIER STEWARD WALLET</span><h1>Move your earlier funds.</h1><p>This is a transfer to your connected owner wallet, <strong>not a sale</strong>. Move one full token balance at a time. Your owner wallet pays the Robinhood Chain network fee.</p></div>{earlierLoading?<p>Checking the earlier wallet…</p>:!earlierWallet?<p>No earlier wallet is available for this account.</p>:<><dl className="ws-v3-wallet-route"><div><dt>From · earlier Steward wallet</dt><dd><a href={`https://robinhoodchain.blockscout.com/address/${earlierWallet.safe}`} target="_blank" rel="noopener noreferrer">{earlierWallet.safe} ↗</a></dd></div><div><dt>To · your connected owner wallet</dt><dd>{address||'Connect your owner wallet on Overview first'}</dd></div></dl>{!earlierWallet.verified&&<p role="status">The earlier wallet owner could not be verified right now. Refresh before reviewing a transfer.</p>}<div className="ws-v3-fund-list">{visibleAssets.length?visibleAssets.map(asset=><article className="ws-v3-fund-card" key={asset.symbol}><div><span>{asset.symbol}</span><strong>{asset.quantity??'Balance unavailable'}</strong><small>{asset.symbol==='USDG'?'Available USDG':'Stock tokens'} · Robinhood Chain</small></div><button type="button" disabled={!address||!earlierWallet.verified||asset.quantity===null} onClick={()=>openEarlierSend(asset)}>Review transfer <ArrowUpRight size={17}/></button></article>):<p>No positive token balances were found in this earlier wallet.</p>}</div><button type="button" className="ws-v3-refresh-earlier" onClick={()=>setEarlierRefresh(value=>value+1)}>Refresh earlier balances</button></>}</section>}
    <div className="ws-v2-backdrop" data-open={!!sheet} onClick={close} aria-hidden="true"/>
    <div className="ws-v2-sheet ws-v4-dialog" data-open={!!sheet} aria-hidden={!sheet} inert={!sheet} ref={dialog} role={sheet?'dialog':undefined} aria-modal={sheet?'true':undefined} aria-label={sheet?`${sheet} in Stock Steward`:undefined}><div className="ws-v2-sheet-grip" aria-hidden="true"/><header className="ws-v2-sheet-head"><div><small>{sheet==='buy'?'PLACE AN ORDER':sheet==='sell'?'EXCHANGE A HOLDING':'MOVE AN ASSET'}</small><h2>{sheet==='buy'?'Buy stock tokens':sheet==='sell'?'Sell for USDG':'Send to your wallet'}</h2></div><button type="button" onClick={close} aria-label="Close dialog"><X size={20}/></button></header><div className="ws-v2-sheet-scroll">
      <div hidden={sheet!=='buy'} className="ws-v2-sheet-content"><p className="ws-v2-sheet-intro">{publicMode?'Review each real purchase within your saved limits. You approve the exact order in your wallet.':'Real buying is available only in the private pilot. Your limits apply, and you approve the exact order in your wallet.'}</p>{!address&&<button type="button" className="ws-v2-connect-link" onClick={()=>{close();focusSetup();}}>Connect and verify wallet</button>}<RealOrderPanel key={`orders-${address}-${mandate.version}`} provider={walletProvider} address={address} onOpenMandate={onOpenMandate} onOpenOverview={close}/></div>
      <div hidden={sheet!=='sell'} className="ws-v2-sheet-content"><p className="ws-v2-sheet-intro">Review a fresh quote for your full holding. The sale returns USDG to your current Steward wallet.</p>{!address&&<button type="button" className="ws-v2-connect-link" onClick={()=>{close();focusSetup();}}>Connect and verify wallet</button>}<CurrentWalletRecovery key={`sell-${address}-${mandate.version}`} provider={walletProvider} address={address} mandateVersion={mandate.version} flow="sell"/></div>
      <div hidden={sheet!=='send'} className="ws-v2-sheet-content"><p className="ws-v2-sheet-intro">Move a full token balance to your connected owner wallet. This is a transfer, not a sale.</p>{!address&&<button type="button" className="ws-v2-connect-link" onClick={()=>{close();focusSetup();}}>Connect and verify wallet</button>}{sendFrom==='earlier'&&earlierWallet&&selectedAsset?<PreviousWalletRecovery key={`earlier-${earlierWallet.safe}-${selectedAsset.symbol}`} wallet="previous" provider={walletProvider} address={address} safe={earlierWallet.safe} assets={[selectedAsset]} onComplete={()=>setEarlierRefresh(value=>value+1)} flow="send"/>:<CurrentWalletRecovery key={`send-${address}-${mandate.version}`} provider={walletProvider} address={address} mandateVersion={mandate.version} flow="send"/>}</div>
    </div></div>
  </section>;
}
