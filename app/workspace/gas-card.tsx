'use client';
import {useCallback,useEffect,useState} from 'react';
import {Fuel} from 'lucide-react';
import {matchingWallet,type WalletProvider} from '@/lib/browser-wallet';
type Gas={balanceWei:string;balanceCents:number|null;maxFeeCents:number;tradesLeft:number|null;state:'ok'|'low'|'empty'|'unknown';topUpWei:string|null};
const usd=(c:number)=>`$${(c/100).toFixed(2)}`;
// Automatic trades pay network fees from a little ETH on the session key.
export default function GasCard({provider,address}:{provider:WalletProvider|null;address:string}){
 const [gas,setGas]=useState<Gas|null>(null),[session,setSession]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{try{const r=await fetch('/api/workspace/autonomy/gas',{cache:'no-store'});const b=await r.json() as {gas:Gas|null;session?:string;error?:string};if(!r.ok)throw Error(b.error);setGas(b.gas);setSession(b.session??'');}catch(e){setError(e instanceof Error?e.message:'Unavailable.');}},[]);
 useEffect(()=>{const t=setTimeout(()=>void load(),0);return()=>clearTimeout(t);},[load]);
 async function topUp(){if(!provider||!gas?.topUpWei||!session)return;setBusy(true);setError('');setNotice('');try{await matchingWallet(provider,address);await provider.request({method:'eth_sendTransaction',params:[{from:address,to:session,value:'0x'+BigInt(gas.topUpWei).toString(16)}]});setNotice('Top-up sent. It shows here once it confirms.');setTimeout(()=>void load(),15000);}catch(e){setError(e instanceof Error?e.message:'Top-up was not sent.');}finally{setBusy(false);}}
 if(!gas)return error?<p className="ws-muted">{error}</p>:null;
 const eth=(Number(BigInt(gas.balanceWei))/1e18).toFixed(5);
 return <section className="ws-gas" data-state={gas.state} aria-label="Gas for automatic trades">
  <Fuel size={18} aria-hidden="true"/>
  <div><strong>{gas.state==='empty'?'Gas is empty: automatic trades are stopped':gas.state==='low'?'Gas is running low':'Gas for automatic trades'}</strong>
   <small>{eth} ETH{gas.balanceCents!==null?` · ${usd(gas.balanceCents)}`:''}{gas.tradesLeft!==null?` · about ${gas.tradesLeft} trade${gas.tradesLeft===1?'':'s'} at your ${usd(gas.maxFeeCents)} fee limit`:''}</small></div>
  {gas.topUpWei&&<button type="button" className={gas.state==='ok'?'ws-action-quiet':'ws-action-primary'} disabled={busy||!provider} onClick={topUp}>{busy?'Confirm in wallet…':`Top up ~${usd(gas.maxFeeCents*10)}`}</button>}
  {notice&&<small role="status">{notice}</small>}{error&&<small role="alert" className="ws-error">{error}</small>}
 </section>;
}
