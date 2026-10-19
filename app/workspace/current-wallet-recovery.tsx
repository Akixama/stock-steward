'use client';
import {useEffect,useState} from 'react';
import type {WalletProvider} from '@/lib/browser-wallet';
import PreviousWalletRecovery from './previous-wallet-recovery';

type Wallet={safe:string;mandateVersion:number;usdg:string|null;holdings:{symbol:string;tokens:string|null}[];verified:boolean};

export default function CurrentWalletRecovery({provider,address,mandateVersion,flow='all'}:{provider:WalletProvider|null;address:string;mandateVersion:number;flow?:'all'|'sell'|'send'}){
 const [wallet,setWallet]=useState<Wallet|null>(null),[refresh,setRefresh]=useState(0);
 useEffect(()=>{if(!address){return;}const controller=new AbortController();void fetch('/api/workspace/wallets/previous?wallet=current',{cache:'no-store',signal:controller.signal}).then(async response=>response.ok?response.json() as Promise<{wallet:Wallet|null}>:null).then(result=>{if(!controller.signal.aborted)setWallet(result?.wallet??null);}).catch(()=>{});return()=>controller.abort();},[address,mandateVersion,refresh]);
 if(!address||!wallet||wallet.mandateVersion!==mandateVersion)return null;
 return <div className="ws-previous-wallet" role="note"><span className="ws-label">YOUR STEWARD WALLET</span><strong>{flow==='sell'?'Exchange a holding for USDG.':'Move holdings back to your own wallet.'}</strong><p>{flow==='sell'?'Review a fresh quote and approve the exact sale in your wallet. USDG remains in your Steward wallet.':'This option remains available when buying permission expires or is turned off. Moving Stock Tokens is not a sale.'}</p>
  {wallet.verified?<><div className="ws-previous-balances"><span>USDG <b>{wallet.usdg??'Balance unavailable'}</b></span>{wallet.holdings.map(holding=><span key={holding.symbol}>{holding.symbol} tokens <b>{holding.tokens??'Balance unavailable'}</b></span>)}</div><PreviousWalletRecovery wallet="current" provider={provider} address={address} safe={wallet.safe} assets={[{symbol:'USDG',quantity:wallet.usdg},...wallet.holdings.map(holding=>({symbol:holding.symbol,quantity:holding.tokens}))]} onComplete={()=>setRefresh(value=>value+1)} flow={flow}/></>:<p>We could not verify this wallet just now. Refresh before trying a transfer.</p>}
  <a href={`https://robinhoodchain.blockscout.com/address/${wallet.safe}`} target="_blank" rel="noopener noreferrer">View this wallet on Robinhood Chain ↗</a>
 </div>;
}
