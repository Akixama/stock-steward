'use client';

import {useEffect, useMemo, useState} from 'react';
import {ArrowUpRight, ChevronRight, RefreshCw} from 'lucide-react';
import {parseUnits} from 'viem';
import type {PricedObservation} from '@/lib/chain-analysis';

type Wallet = {safe:string;usdg:string|null;holdings:{symbol:string;tokens:string|null}[];verified:boolean};
type Action = 'setup'|'buy'|'sell'|'send';
const money = (micro:bigint) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(micro)/1_000_000);
const quantity = (value:string|null) => value===null?'Unavailable':new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(Number(value));
const recent = (record:PricedObservation) => record.valuationComplete && Date.now()-Date.parse(record.observedAt)<120_000 && Date.now()>=Date.parse(record.observedAt);

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

export default function PortfolioHome({address,onAction,progress,onProgress}:{address:string;onAction:(action:Action)=>void;progress:{done:number;total:number;next:string;complete:boolean};onProgress:()=>void}){
  const [walletState,setWallet]=useState<Wallet|null>(null);
  const [walletAddress,setWalletAddress]=useState('');
  const [records,setRecords]=useState<PricedObservation[]>([]);
  const [loading,setLoading]=useState(false);
  const [selected,setSelected]=useState<string|null>(null);
  const [refresh,setRefresh]=useState(0);
  useEffect(()=>{
    if(!address)return;
    const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted)setLoading(true);});
    void Promise.all([
      fetch('/api/workspace/wallets/previous?wallet=current',{cache:'no-store',signal:controller.signal}).then(r=>r.ok?r.json():null),
      fetch('/api/workspace/chain',{cache:'no-store',signal:controller.signal}).then(r=>r.ok?r.json():null),
    ]).then(([balance,history])=>{if(controller.signal.aborted)return;setWalletAddress(address);setWallet((balance as {wallet?:Wallet}|null)?.wallet??null);setRecords((history as {records?:PricedObservation[]}|null)?.records??[]);}).catch(()=>{if(!controller.signal.aborted){setWalletAddress(address);setWallet(null);setRecords([]);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[address,refresh]);
  useEffect(()=>{const update=()=>setRefresh(n=>n+1);window.addEventListener('steward-order-updated',update);window.addEventListener('steward-permission-updated',update);return()=>{window.removeEventListener('steward-order-updated',update);window.removeEventListener('steward-permission-updated',update);};},[]);
  const wallet=walletAddress===address?walletState:null;
  const matching=useMemo(()=>records.filter(item=>wallet&&item.address.toLowerCase()===wallet.safe.toLowerCase()).sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)),[records,wallet]);
  const latest=matching.at(-1);
  const priced=latest&&recent(latest)?latest:null;
  const cash=wallet?.usdg===null||wallet?.usdg===undefined?null:parseUnits(wallet.usdg,6);
  const complete=!!wallet?.verified&&cash!==null&&!!priced&&priced.usdg!==null&&parseUnits(priced.usdg,6)===cash;
  const total=complete?cash!+BigInt(priced!.subtotalMicroUsd):null;
  const points=matching.filter(recent).slice(-12).map(item=>Number(BigInt(item.subtotalMicroUsd)+parseUnits(item.usdg??'0',6))/1_000_000).filter(Number.isFinite);
  const holdings=wallet?.holdings.filter(item=>item.tokens!==null&&Number(item.tokens)>0)??[];
  const stockValue=(symbol:string)=>{
    if(!priced)return null;
    const holding=priced.holdings.find(item=>item.symbol===symbol);
    const value=holding&&priced.prices[holding.contract]?.valueMicroUsd;
    return value===null||value===undefined?null:money(BigInt(value));
  };
  return <div className="ws-v2-home">
    <section className="ws-v2-portfolio" aria-label="Portfolio overview">
      <div className="ws-v2-portfolio-copy"><div className="ws-v2-overline"><span>YOUR STEWARD WALLET</span><span className="ws-v2-pilot">PRIVATE PILOT</span></div>
        <span className="ws-v2-value-label">Portfolio value <span>· indicative</span></span>
        {loading?<div className="ws-v2-skeleton ws-v2-skeleton-value" aria-label="Loading portfolio value"/>:<CountedValue value={total}/>}
        <p>{!address?'Connect your wallet to see its balances.':!wallet?'Wallet balances are unavailable right now.':!complete?'A complete, recent stock valuation is unavailable. Your confirmed cash balance is shown below.':'USDG plus supported stock tokens, using a recent saved estimate. This is not a sale quote.'}</p>
        <div className="ws-v2-portfolio-meta"><div><span>USDG available</span><strong>{cash===null?'—':money(cash)}</strong></div><div><span>Stock holdings</span><strong>{wallet?.verified?holdings.length:'—'}</strong></div></div>
      </div>
      <div className="ws-v2-history"><div><span>VALUE HISTORY</span><button type="button" onClick={()=>setRefresh(n=>n+1)} disabled={!address||loading} aria-label="Refresh portfolio balances"><RefreshCw size={16}/></button></div><HistoryLine points={points}/><small>{latest?`Last saved check ${new Date(latest.observedAt).toLocaleString()}`:'No saved value history yet'}</small></div>
    </section>
    {!progress.complete&&<button type="button" className="ws-v2-progress" onClick={onProgress}><span className="ws-v2-progress-icon">{progress.done+1}</span><span><small>SETUP · {progress.done} OF {progress.total} COMPLETE</small><strong>{progress.next}</strong></span><span className="ws-v2-progress-track" aria-hidden="true"><i style={{width:`${Math.round(progress.done/progress.total*100)}%`}}/></span><ChevronRight size={18}/></button>}
    <section className="ws-v2-holdings" aria-label="Holdings"><div className="ws-v2-section-head"><div><span>YOUR ASSETS</span><h2>Holdings</h2></div><span>{wallet?.verified?`${holdings.length+1} assets`:'Wallet not connected'}</span></div>
      {loading?<div className="ws-v2-holding-skeleton"><div className="ws-v2-skeleton"/><div className="ws-v2-skeleton"/><div className="ws-v2-skeleton"/></div>:!address||!wallet?.verified?<div className="ws-v2-empty"><strong>Your assets will appear here.</strong><p>Connect and verify your wallet to see USDG and supported stock tokens.</p><button type="button" onClick={()=>onAction('setup')}>Set up wallet <ChevronRight size={16}/></button></div>:<div className="ws-v2-holding-list">
        <button type="button" className="ws-v2-holding" aria-expanded={selected==='USDG'} onClick={()=>setSelected(selected==='USDG'?null:'USDG')}><span className="ws-v2-asset-mark">$</span><span className="ws-v2-asset-name"><strong>USDG</strong><small>Available to buy</small></span><span className="ws-v2-asset-figures"><strong>{cash===null?'—':money(cash)}</strong><small>{quantity(wallet.usdg)} USDG</small></span><ChevronRight size={17}/></button>
        {selected==='USDG'&&<div className="ws-v2-holding-detail"><p>Held in your Steward wallet. Send moves the full USDG balance to your verified owner wallet.</p><button type="button" onClick={()=>onAction('send')}>Send USDG <ArrowUpRight size={15}/></button></div>}
        {holdings.map(item=><div key={item.symbol}><button type="button" className="ws-v2-holding" aria-expanded={selected===item.symbol} onClick={()=>setSelected(selected===item.symbol?null:item.symbol)}><span className="ws-v2-asset-mark">{item.symbol.slice(0,1)}</span><span className="ws-v2-asset-name"><strong>{item.symbol}</strong><small>Stock token</small></span><span className="ws-v2-asset-figures"><strong>{stockValue(item.symbol)??'Value unavailable'}</strong><small>{quantity(item.tokens)} tokens</small></span><ChevronRight size={17}/></button>{selected===item.symbol&&<div className="ws-v2-holding-detail"><p>Indicative value is shown only when a recent saved estimate is complete. A sale needs a fresh quote and your wallet approval.</p><div><a href={`/chart?symbol=${encodeURIComponent(item.symbol)}`}>View market <ArrowUpRight size={15}/></a><button type="button" onClick={()=>onAction('sell')}>Sell holding <ArrowUpRight size={15}/></button></div></div>}</div>)}
      </div>}
    </section>
  </div>;
}
