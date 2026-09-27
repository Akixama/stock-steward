'use client';
import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {ArrowUpRight,Wallet,X} from 'lucide-react';
import useBrowserWallets from './use-browser-wallets';
import type {BrowserWallet,WalletProvider} from '@/lib/browser-wallet';
export default function WalletConnect({disabled,onConnected}:{disabled:boolean;onConnected:(provider:WalletProvider,address:string)=>void}){
 const wallets=useBrowserWallets(),[open,setOpen]=useState(false),[pending,setPending]=useState<string|null>(null),[error,setError]=useState('');const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);
 function changeOpen(next:boolean){generation.current++;setOpen(next);setPending(null);setError('');if(next)window.dispatchEvent(new Event('eip6963:requestProvider'));}
 async function choose(wallet:BrowserWallet){const ticket=++generation.current;setPending(wallet.id);setError('');try{
  const accounts=await wallet.provider.request({method:'eth_requestAccounts'});
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||!/^0x[0-9a-f]{40}$/i.test(accounts[0]))throw Error();
  if(ticket!==generation.current)return;onConnected(wallet.provider,accounts[0]);setOpen(false);setPending(null);
 }catch{if(ticket===generation.current){setPending(null);setError('Connection canceled or unavailable. Choose a wallet to try again.');}}}
 return <Dialog.Root open={open} onOpenChange={changeOpen}><Dialog.Trigger asChild><button type="button" disabled={disabled}>Connect browser wallet <ArrowUpRight size={16}/></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="ws-wallet-overlay"/><Dialog.Content className="ws-wallet-dialog"><div className="ws-wallet-dialog-head"><Wallet size={22}/><Dialog.Close asChild><button type="button" aria-label="Close wallet chooser"><X size={20}/></button></Dialog.Close></div><Dialog.Title>Connect your wallet</Dialog.Title><Dialog.Description>Choose a detected wallet. Its connection prompt opens immediately; no signature or spending permission is requested.</Dialog.Description>
  <div className="ws-wallet-list">{wallets.map(w=><button key={w.id} type="button" disabled={pending!==null} onClick={()=>choose(w)}><span className="ws-wallet-letter" aria-hidden="true">{w.name.slice(0,1)}</span><span><strong>{w.name}</strong><small>{pending===w.id?'Approve the connection in your wallet…':'Detected in this browser'}</small></span><ArrowUpRight size={17}/></button>)}</div>
  {!wallets.length&&<div className="ws-chain-brief"><strong>No browser wallet detected</strong><p>Open this page in your wallet’s browser or a browser with an EVM wallet extension. You can watch a public address or use Practice without one.</p></div>}
  {error&&<p className="ws-error" role="alert">{error}</p>}<p className="ws-wallet-dialog-note" role="status">{pending?'You can close this chooser to cancel connecting in Steward.':'Wallet names are extension-supplied labels. Your keys stay in your wallet.'}</p>
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
