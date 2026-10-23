'use client';
import {useEffect,useRef,useState} from 'react';
import {Dialog} from 'radix-ui';
import {ArrowUpRight,ChevronRight,LoaderCircle,LockKeyhole,Wallet,X} from 'lucide-react';
import useBrowserWallets from './use-browser-wallets';
import {shareWalletSession} from './wallet-session';
import type {BrowserWallet,WalletProvider} from '@/lib/browser-wallet';
export default function WalletConnect({disabled,onConnected}:{disabled:boolean;onConnected:(provider:WalletProvider,address:string)=>void}){
 const wallets=useBrowserWallets(),[open,setOpen]=useState(false),[pending,setPending]=useState<string|null>(null),[error,setError]=useState('');const generation=useRef(0);
 useEffect(()=>()=>{generation.current++;},[]);
 function changeOpen(next:boolean){generation.current++;setOpen(next);setPending(null);setError('');if(next)window.dispatchEvent(new Event('eip6963:requestProvider'));}
 async function choose(wallet:BrowserWallet){const ticket=++generation.current;setPending(wallet.id);setError('');try{
  const accounts=await wallet.provider.request({method:'eth_requestAccounts'});
  if(!Array.isArray(accounts)||typeof accounts[0]!=='string'||!/^0x[0-9a-f]{40}$/i.test(accounts[0]))throw Error();
  if(ticket!==generation.current)return;shareWalletSession({provider:wallet.provider,address:accounts[0]});onConnected(wallet.provider,accounts[0]);setOpen(false);setPending(null);
 }catch{if(ticket===generation.current){setPending(null);setError('Connection canceled or unavailable. Choose a wallet to try again.');}}}
 return <Dialog.Root open={open} onOpenChange={changeOpen}><Dialog.Trigger asChild><button type="button" className="ws-action-secondary ws-wallet-connect-trigger" disabled={disabled}>Connect wallet <ArrowUpRight size={16}/></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="ws-wallet-overlay"/><Dialog.Content className="ws-wallet-dialog ws-wallet-chooser"><div className="ws-wallet-dialog-head"><span className="ws-wallet-heading-icon"><Wallet size={20}/></span><Dialog.Close asChild><button type="button" aria-label="Close wallet chooser"><X size={18}/></button></Dialog.Close></div><Dialog.Title>Connect your wallet</Dialog.Title><Dialog.Description>{wallets.length?'Choose your wallet. Connecting does not approve any spending.':'Connecting does not approve any spending.'}</Dialog.Description>
  {wallets.length>0&&<div className="ws-wallet-list-label">Available in this browser <span>{wallets.length}</span></div>}
  <div className="ws-wallet-list">{wallets.map(w=><button key={w.id} type="button" disabled={pending!==null} data-pending={pending===w.id} onClick={()=>choose(w)}><span className="ws-wallet-choice-icon" aria-hidden="true"><Wallet size={20}/></span><span className="ws-wallet-choice-name"><strong>{w.name}</strong>{pending===w.id&&<small>Approve in your wallet</small>}</span>{pending===w.id?<LoaderCircle className="ws-wallet-spinner" size={18}/>:<ChevronRight size={18}/>}</button>)}</div>
  {!wallets.length&&<div className="ws-chain-brief"><strong>No wallet found in this browser</strong><p>Install a wallet extension such as MetaMask, or open this page in your wallet app’s browser. Practice works without a wallet.</p></div>}
  {error&&<p className="ws-error" role="alert">{error}</p>}<div className="ws-wallet-privacy"><LockKeyhole size={15}/><span>Your keys stay in your wallet.</span></div><p className="ws-wallet-dialog-note" role="status">{pending?'Waiting for your wallet. Close this window to cancel in Steward.':'Wallet names are supplied by your browser extensions.'}</p>
 </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
