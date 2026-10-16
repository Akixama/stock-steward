'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,ShieldCheck,X} from 'lucide-react';
import {useRouter} from 'next/navigation';
import type {WalletProvider} from '@/lib/browser-wallet';
import WalletSetup from '../workspace/wallet-setup';
import RealOrderPanel from '../workspace/real-order-panel';

type Access='checking'|'ready'|'signed-out'|'unavailable';

export default function MarketOrderDrawer({symbol,onClose}:{symbol:string;onClose:()=>void}){
 const router=useRouter();
 const dialogRef=useRef<HTMLDialogElement>(null);
 const [access,setAccess]=useState<Access>('checking');
 const [provider,setProvider]=useState<WalletProvider|null>(null);
 const [address,setAddress]=useState('');
 const receiveProvider=useCallback((next:WalletProvider|null)=>setProvider(()=>next),[]);
 const receiveAddress=useCallback((next:string)=>setAddress(next),[]);

 useEffect(()=>{const dialog=dialogRef.current;if(!dialog)return;dialog.showModal();return()=>{if(dialog.open)dialog.close();};},[]);
 useEffect(()=>{const controller=new AbortController();fetch('/api/workspace/ownership',{cache:'no-store',signal:controller.signal})
  .then(response=>{if(response.status===401)setAccess('signed-out');else setAccess(response.ok?'ready':'unavailable');})
  .catch(()=>{if(!controller.signal.aborted)setAccess('unavailable');});return()=>controller.abort();},[]);

 const signInHref=`/signin-with-chatgpt?return_to=${encodeURIComponent(`/chart?symbol=${symbol}`)}`;
 return <dialog ref={dialogRef} className="market-order-dialog" aria-label={`Manual buy for ${symbol}`} onClose={onClose}>
  <div id="ws-wallet-orders" className="ws market-order-shell">
   <div className="market-order-head"><div><span className="market-data-label">BUY FROM MARKETS</span><h2>Buy {symbol} while you watch.</h2><p>The chart shows the regular share’s price. Before you approve a buy, you’ll see its cost and the minimum number of stock tokens you’ll receive.</p></div><button type="button" className="market-order-close" aria-label="Close order ticket" onClick={()=>dialogRef.current?.close()}><X size={18}/></button></div>
   <div className="market-order-safety"><ShieldCheck size={17}/><span>Every order is checked against your saved limits and signed in your own wallet.</span></div>
   {access==='checking'&&<p className="market-order-message" role="status">Checking your account…</p>}
   {access==='signed-out'&&<div className="market-order-message"><strong>Sign in to buy.</strong><p>You can keep browsing charts without signing in.</p><a className="market-order-link" href={signInHref}>Sign in and return to {symbol} <ArrowUpRight size={16}/></a></div>}
   {access==='unavailable'&&<div className="market-order-message" role="alert"><strong>Account check unavailable.</strong><p>Try again shortly. No order was prepared or sent.</p><button type="button" onClick={()=>dialogRef.current?.close()}>Close ticket</button></div>}
   {access==='ready'&&<><WalletSetup onProvider={receiveProvider} onAddress={receiveAddress} disabled={false}/><RealOrderPanel key={`${symbol}-${address}`} provider={provider} address={address} preferredSymbol={symbol} onOpenMandate={()=>router.push('/workspace?view=mandate')}/></>}
  </div>
 </dialog>;
}
