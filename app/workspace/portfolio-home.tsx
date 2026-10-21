'use client';
import {formatWorkspaceDate} from '@/lib/workspace-date';


import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ArrowUpRight, ChevronRight, RefreshCw} from 'lucide-react';
import {parseUnits} from 'viem';
import type {PricedObservation} from '@/lib/chain-analysis';
import {visiblePortfolioValue,walletBalanceFingerprint} from '@/lib/portfolio-value';
import {completeWalletBalance,parseLastVerifiedBalance,stockHoldingCount} from '@/lib/wallet-balance-display';

type Wallet = {safe:string;usdg:string|null;holdings:{symbol:string;tokens:string|null}[];verified:boolean;balanceReadComplete?:boolean;checkedAt?:string|null};
type Action = 'setup'|'buy'|'sell'|'send';
const money = (micro:bigint) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(micro)/1_000_000);
const quantity = (value:string|null) => value===null?'Unavailable':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(Number(value));
const recent = (record:PricedObservation) => Date.now()-Date.parse(record.observedAt)<120_000 && Date.now()>=Date.parse(record.observedAt);

function CountedValue({value}:{value:bigint|null}){
  const [shown,setShown]=useState(0);
  useEffect(()=>{
    if(value===null)return;
    const final=Number(value)/1_000_000;
    if(!Number.isFinite(final)||window.matchMedia('(prefers-reduced-motion: reduce)').matches){const frame=requestAnimationFrame(()=>setShown(final));return()=>cancelAnimationFrame(frame);}
    let frame=0;const start=performance.now();
    const tick=(now:number)=>{const t=Math.min(1,(now-start)/620);setShown(final*(1-(1-t)**3));if(t<1)frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[value]);
  return <span className="ws-v2-value" aria-label={value===null?'Portfolio value unavailable':money(value)}>{value===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(shown)}</span>;
}

function HistoryLine({points}:{points:number[]}){
  if(points.length<2)return <div className="ws-v2-chart-empty"><span aria-hidden="true"/><small>History appears after balance checks</small></div>;
  const low=Math.min(...points),high=Math.max(...points),spread=Math.max(high-low,0.01);
  const coordinates=points.map((point,index)=>`${(index/(points.length-1))*100},${68-((point-low)/spread)*52}`).join(' ');
  return <svg className="ws-v2-chart" viewBox="0 0 100 80" preserveAspectRatio="none" role="img" aria-label="Saved portfolio value observations"><polyline points={coordinates}/></svg>;
}

export default function PortfolioHome({address,onAction,publicMode}:{address:string;onAction:(action:Action)=>void;publicMode:boolean}){
  const [walletState,setWallet]=useState<Wallet|null>(null);
  const [lastVerified,setLastVerified]=useState<Wallet|null>(null);
  const [walletAddress,setWalletAddress]=useState('');
  const [records,setRecords]=useState<PricedObservation[]>([]);
  const [loading,setLoading]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [refreshMessage,setRefreshMessage]=useState('');
  const activeRefresh=useRef<AbortController|null>(null);
  const lastBalance=useRef<string|null>(null);
  const lastAutoValuation=useRef<string|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [copied,setCopied]=useState(false);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>()=>{activeRefresh.current?.abort();},[address]);
  useEffect(()=>{
    if(!address)return;
    const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted)setLoading(true);});
    void Promise.all([
      fetch('/api/workspace/wallets/previous?wallet=current',{cache:'no-store',signal:controller.signal}).then(r=>r.ok?r.json():null),
      fetch('/api/workspace/chain',{cache:'no-store',signal:controller.signal}).then(r=>r.ok?r.json():null),
    ]).then(([balance,history])=>{if(controller.signal.aborted)return;const next=(balance as {wallet?:Wallet}|null)?.wallet??null;lastBalance.current=walletBalanceFingerprint(next);setWalletAddress(address);setWallet(next);setRecords((history as {records?:PricedObservation[]}|null)?.records??[]);}).catch(()=>{if(!controller.signal.aborted){setWalletAddress(address);setWallet(null);setRecords([]);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[address,refresh]);
  useEffect(()=>{const update=()=>setRefresh(n=>n+1);window.addEventListener('steward-order-updated',update);window.addEventListener('steward-permission-updated',update);return()=>{window.removeEventListener('steward-order-updated',update);window.removeEventListener('steward-permission-updated',update);};},[]);
  useEffect(()=>{
    if(!address){setLastVerified(null);return;}
    const key=`steward-last-verified-balance:${address.toLowerCase()}`;
    if(walletState&&completeWalletBalance(walletState)){
      setLastVerified(walletState);
      try{localStorage.setItem(key,JSON.stringify(walletState));}catch{/* Optional browser cache. */}
    }else{
      try{setLastVerified(parseLastVerifiedBalance(localStorage.getItem(key),walletState?.safe));}
      catch{setLastVerified(null);}
    }
  },[address,walletState]);
  const refreshValuation=useCallback(async()=>{
    if(!address||activeRefresh.current)return false;
    const controller=new AbortController();activeRefresh.current=controller;
    setRefreshing(true);setRefreshMessage('Checking your wallet and saving a new value…');
    try{
      const walletResponse=await fetch('/api/workspace/wallets/previous?wallet=current',{cache:'no-store',signal:controller.signal});
      const walletBody=await walletResponse.json() as {wallet?:Wallet|null;error?:string};
      if(!walletResponse.ok)throw new Error(walletBody.error||'Wallet balances could not be loaded.');
      if(!walletBody.wallet?.verified||!walletBody.wallet.safe)throw new Error('Verify your wallet and finish setup before checking its value.');
      const response=await fetch('/api/workspace/chain',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:walletBody.wallet.safe}),cache:'no-store',signal:controller.signal});
      const result=await response.json() as {saved?:boolean;error?:string;warning?:string};
      if(!response.ok)throw new Error(result.error||'Could not check your wallet value.');
      if(!result.saved)throw new Error(result.warning||'The new value could not be saved. Try again later.');
      if(!controller.signal.aborted){setRefresh(n=>n+1);setRefreshMessage('New value saved. Balances are updating.');return true;}
    }catch(error){
      if(!controller.signal.aborted)setRefreshMessage(error instanceof Error?error.message:'Could not check your wallet value.');
    }finally{
      setRefreshing(false);
      if(activeRefresh.current===controller)activeRefresh.current=null;
    }
    return false;
  },[address]);
  useEffect(()=>{
    if(!address)return;
    let active=true;
    const check=async()=>{
      if(!active||document.visibilityState==='hidden'||activeRefresh.current)return;
      try{
        const response=await fetch('/api/workspace/wallets/previous?wallet=current',{cache:'no-store'});
        if(!response.ok)return;
        const next=(await response.json() as {wallet?:Wallet|null}).wallet??null;
        const fingerprint=walletBalanceFingerprint(next);
        if(!active||!fingerprint)return;
        if(lastBalance.current&&lastBalance.current!==fingerprint){
          if(await refreshValuation())lastBalance.current=fingerprint;
        }else lastBalance.current=fingerprint;
      }catch{/* The next scheduled check can retry a read-only balance refresh. */}
    };
    const interval=window.setInterval(()=>void check(),45_000);
    document.addEventListener('visibilitychange',check);
    return()=>{active=false;window.clearInterval(interval);document.removeEventListener('visibilitychange',check);};
  },[address,refreshValuation]);
  useEffect(()=>{
    if(!walletState?.verified||walletAddress!==address||!walletState.holdings.some(item=>item.tokens!==null&&Number(item.tokens)>0))return;
    const fingerprint=walletBalanceFingerprint(walletState);
    if(!fingerprint||lastAutoValuation.current===fingerprint)return;
    const saved=records.find(item=>item.address.toLowerCase()===walletState.safe.toLowerCase()&&recent(item)
      &&item.usdg===walletState.usdg&&walletState.holdings.every(held=>{
        if(held.tokens===null||Number(held.tokens)===0)return true;
        return item.holdings.some(observed=>observed.symbol===held.symbol&&observed.quantity===held.tokens);
      }));
    if(saved)return;
    lastAutoValuation.current=fingerprint;
    let cancelled=false;
    queueMicrotask(()=>{if(!cancelled)void refreshValuation();});
    return()=>{cancelled=true;};
  },[address,walletAddress,walletState,records,refreshValuation]);
  const wallet=walletAddress===address?walletState:null;
  const matching=useMemo(()=>records.filter(item=>wallet&&item.address.toLowerCase()===wallet.safe.toLowerCase()).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)),[records,wallet]);
  const latest=matching.at(-1);
  const priced=wallet&&latest&&recent(latest)&&latest.usdg===wallet.usdg&&wallet.holdings.every(held=>{
    if(held.tokens===null||Number(held.tokens)===0)return true;
    return latest.holdings.some(observed=>observed.symbol===held.symbol&&observed.quantity===held.tokens);
  })?latest:null;
  const cash=wallet?.usdg===null||wallet?.usdg===undefined?null:parseUnits(wallet.usdg,6);
   const stockCount=stockHoldingCount(wallet);
   const balanceKnown=stockCount!==null;
   const complete=balanceKnown&&cash!==null&&(stockCount===0||!!priced&&priced.valuationComplete);
  const total=visiblePortfolioValue(cash,priced?BigInt(priced.subtotalMicroUsd):null);
  const points=matching.filter(item=>recent(item)&&item.valuationComplete).slice(-12).map(item=>Number(BigInt(item.subtotalMicroUsd)+parseUnits(item.usdg??'0',6))/1_000_000).filter(Number.isFinite);
  const holdings=wallet?.holdings.filter(item=>item.tokens!==null&&Number(item.tokens)>0)??[];
  const unpriced=holdings.filter(item=>!priced?.holdings.some(held=>held.symbol===item.symbol&&typeof priced.prices[held.contract]?.valueMicroUsd==='string'));
  const stockValue=(symbol:string)=>{
    if(!priced)return null;
    const holding=priced.holdings.find(item=>item.symbol===symbol);
    const value=holding&&priced.prices[holding.contract]?.valueMicroUsd;
    return value===null||value===undefined?null:money(BigInt(value));
  };
  return <div className="ws-v2-home">
    <section className="ws-v2-portfolio" aria-label="Portfolio overview">
      <div className="ws-v2-portfolio-copy"><div className="ws-v2-overline"><span>YOUR STEWARD WALLET</span>{!publicMode&&<span className="ws-v2-pilot">PRIVATE PILOT</span>}</div>
        <span className="ws-v2-value-label">{complete?'Portfolio value':'Value shown'} <span>· {complete?'indicative':'partial'}</span></span>
        {loading?<div className="ws-v2-skeleton ws-v2-skeleton-value" aria-label="Loading portfolio value"/>:<CountedValue value={total}/>}
         <p>{!address?'Connect your wallet to see its balances.':!wallet?'Wallet balances are unavailable right now.':!balanceKnown?'Some wallet balances could not be checked. Any value shown is partial; refresh to try again.':!complete?`USDG and any priced stocks are shown. ${unpriced.map(item=>item.symbol).join(', ')||'Some stock'} price unavailable; this is not your full portfolio value.`:stockCount===0?'Your current USDG balance. A new deposit appears after the next automatic balance check.':'USDG plus supported stock tokens, using a recent saved estimate. This is not a sale quote.'}</p>
         <div className="ws-v2-portfolio-meta"><div><span>USDG available</span><strong>{cash===null?'—':money(cash)}</strong></div><div><span>Stock holdings</span><strong>{stockCount===null?'—':stockCount}</strong></div></div>
         {!balanceKnown&&lastVerified?.checkedAt&&<p role="status">Last verified balances for {lastVerified.safe.slice(0,6)}…{lastVerified.safe.slice(-4)} · {formatWorkspaceDate(lastVerified.checkedAt)}: {lastVerified.usdg} USDG{lastVerified.holdings.filter(item=>Number(item.tokens)>0).map(item=>` · ${item.tokens} ${item.symbol}`).join('')}. These are earlier balances, not a live check.</p>}
      </div>
      <div className="ws-v2-history"><div><span>VALUE HISTORY</span><button type="button" onClick={()=>void refreshValuation()} disabled={!address||loading||refreshing} aria-label="Check and save current wallet value" title="Check and save current wallet value"><RefreshCw size={16}/></button></div><HistoryLine points={points}/><small>{latest?`Last saved check ${formatWorkspaceDate(latest.observedAt)}`:'No saved value history yet'}</small>{refreshMessage&&<small role="status">{refreshMessage}</small>}</div>
    </section>
    <section className="ws-v4-funding" aria-label="Fund your Steward wallet"><div><span>FUND THIS WALLET</span><h2>Add USDG</h2><p>Send USDG to your current Steward wallet before buying. Keep some ETH in your owner wallet for network fees.</p></div>{wallet?.verified&&wallet.safe?<div className="ws-v4-funding-address"><code>{wallet.safe}</code><button type="button" onClick={()=>{void navigator.clipboard.writeText(wallet.safe).then(()=>{setCopied(true);window.setTimeout(()=>setCopied(false),1500);}).catch(()=>setCopied(false));}}>{copied?'Copied':'Copy address'}</button></div>:<button type="button" onClick={()=>onAction('setup')}>Connect wallet <ChevronRight size={16}/></button>}</section>
     <section className="ws-v2-holdings" aria-label="Holdings"><div className="ws-v2-section-head"><div><span>YOUR ASSETS</span><h2>Holdings</h2></div><span>{balanceKnown?`${holdings.length+1} assets`:wallet?.verified?'Balances unavailable':'Wallet not connected'}</span></div>
      {loading?<div className="ws-v2-holding-skeleton"><div className="ws-v2-skeleton"/><div className="ws-v2-skeleton"/><div className="ws-v2-skeleton"/></div>:!address||!wallet?.verified?<div className="ws-v2-empty"><strong>Your assets will appear here.</strong><p>Connect and verify your wallet to see USDG and supported stock tokens.</p><button type="button" onClick={()=>onAction('setup')}>Set up wallet <ChevronRight size={16}/></button></div>:<div className="ws-v2-holding-list">
        <button type="button" className="ws-v2-holding" aria-expanded={selected==='USDG'} onClick={()=>setSelected(selected==='USDG'?null:'USDG')}><span className="ws-v2-asset-mark">$</span><span className="ws-v2-asset-name"><strong>USDG</strong><small>Available to buy</small></span><span className="ws-v2-asset-figures"><strong>{cash===null?'—':money(cash)}</strong><small>{quantity(wallet.usdg)} USDG</small></span><ChevronRight size={17}/></button>
        {selected==='USDG'&&<div className="ws-v2-holding-detail"><p>Held in your Steward wallet. Send moves the full USDG balance to your verified owner wallet.</p><button type="button" onClick={()=>onAction('send')}>Send USDG <ArrowUpRight size={15}/></button></div>}
        {holdings.map(item=><div key={item.symbol}><button type="button" className="ws-v2-holding" aria-expanded={selected===item.symbol} onClick={()=>setSelected(selected===item.symbol?null:item.symbol)}><span className="ws-v2-asset-mark">{item.symbol.slice(0,1)}</span><span className="ws-v2-asset-name"><strong>{item.symbol}</strong><small>Stock token</small></span><span className="ws-v2-asset-figures"><strong>{stockValue(item.symbol)??'Value unavailable'}</strong><small>{quantity(item.tokens)} tokens</small></span><ChevronRight size={17}/></button>{selected===item.symbol&&<div className="ws-v2-holding-detail"><p>Indicative value is shown only when a recent saved estimate is complete. A sale needs a fresh quote and your wallet approval.</p><div><a href={`/chart?symbol=${encodeURIComponent(item.symbol)}`}>View market <ArrowUpRight size={15}/></a><button type="button" onClick={()=>onAction('sell')}>Sell holding <ArrowUpRight size={15}/></button></div></div>}</div>)}
      </div>}
    </section>
  </div>;
}
