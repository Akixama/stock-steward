'use client';
import {useEffect,useState} from 'react';
import {announcedWallet,type BrowserWallet,type WalletProvider} from '@/lib/browser-wallet';
// Discovery requests no account access. Provider names are wallet-supplied labels, not verified identities.
let wallets:BrowserWallet[]=[];let initialized=false;const listeners=new Set<()=>void>();
function initialize(){if(initialized)return;initialized=true;
 window.addEventListener('eip6963:announceProvider',event=>{const wallet=announcedWallet((event as CustomEvent).detail);if(!wallet||wallets.some(w=>w.id===wallet.id||w.provider===wallet.provider)||wallets.length>=20)return;wallets=[...wallets,wallet];listeners.forEach(fn=>fn());});
 window.dispatchEvent(new Event('eip6963:requestProvider'));
}
export default function useBrowserWallets(){const [available,setAvailable]=useState<BrowserWallet[]>([]);
 useEffect(()=>{const update=()=>{const legacy=(window as unknown as {ethereum?:WalletProvider}).ethereum;setAvailable(legacy&&typeof legacy.request==='function'&&!wallets.some(w=>w.provider===legacy)?[...wallets,{id:'browser-default',name:'Browser default wallet',provider:legacy}]:wallets);};listeners.add(update);initialize();update();window.dispatchEvent(new Event('eip6963:requestProvider'));return()=>{listeners.delete(update);};},[]);
 return available;
}
