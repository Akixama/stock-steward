'use client';
import {useEffect,useState} from 'react';
import type {MarketActivity} from '@/lib/market-activity';

type Snapshot={wallet:string|null;holdings:{symbol:string;quantity:string|null;valueMicroUsd:string|null}[]|null;observedAt:string|null;activity:MarketActivity[]};
const money=(micro:string|null)=>micro===null?'Value unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(BigInt(micro))/1_000_000);

export default function MarketActivityPanel(){
  const [snapshot,setSnapshot]=useState<Snapshot|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function load(){setBusy(true);setMessage('');try{
    const response=await fetch('/api/workspace/market-activity',{cache:'no-store'});
    if(response.status===401){setMessage('Sign in to see your holdings and order receipts.');return;}
    const body=await response.json() as Snapshot&{error?:string};
    if(!response.ok)throw Error(body.error??'Activity unavailable.');setSnapshot(body);
  }catch(error){setMessage(error instanceof Error?error.message:'Activity unavailable.');}finally{setBusy(false);}}
  useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timer);},[]);
  return <section className="market-activity" aria-label="Your holdings and Stock Steward trades"><header><div><span>YOUR MARKET ACTIVITY</span><h2>Holdings and receipts</h2><p>Read-only view of your current Steward wallet. A submitted trade is not a completed trade.</p></div><button type="button" onClick={()=>void load()} disabled={busy}>{busy?'Checking…':'Refresh'}</button></header>
    {message&&<p role="status">{message}</p>}
    {snapshot?.wallet&&<><p className="market-activity-wallet">Current Steward wallet · {snapshot.wallet.slice(0,8)}…{snapshot.wallet.slice(-6)}{snapshot.observedAt&&` · checked ${new Date(snapshot.observedAt).toLocaleString()}`}</p>
      <div className="market-activity-columns"><div><h3>Your stock tokens</h3>{snapshot.holdings===null?<p>Balances could not be checked. Try Refresh.</p>:snapshot.holdings.filter(item=>item.quantity!==null&&Number(item.quantity)>0).length? snapshot.holdings.filter(item=>item.quantity!==null&&Number(item.quantity)>0).map(item=><div className="market-activity-row" key={item.symbol}><strong>{item.symbol}</strong><span>{item.quantity} tokens</span><b>{money(item.valueMicroUsd)}</b></div>):<p>No supported stock tokens in this wallet at the latest check.</p>}</div>
      <div><h3>Buys and sells</h3>{snapshot.activity.length?snapshot.activity.map(item=><div className="market-activity-row" key={item.hash}><strong>{item.side==='buy'?'Bought':'Sold'} {item.symbol}</strong><span>{item.amount} · {item.state==='confirmed'?'Finalized':item.state==='reverted'?'Reverted':'Still checking'}</span><a href={`https://robinhoodchain.blockscout.com/tx/${item.hash}`} target="_blank" rel="noreferrer">Receipt ↗</a></div>):<p>No Stock Steward buy or sale receipts yet.</p>}</div></div></>}
  </section>;
}
