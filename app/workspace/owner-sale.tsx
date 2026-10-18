'use client';
import {useState} from 'react';
import {parseUnits} from 'viem';
import {matchingWallet,type WalletProvider} from '@/lib/browser-wallet';

type Draft={symbol:string;safe:string;owner:string;quantity:string;estimatedUsdg:string;minimumUsdg:string;minimumUsdgRaw:string;expiresAt:string;gasEstimate:string;transaction:{from:string;to:string;value:string;data:string};simulated:boolean};
type Wallet={wallet:{usdg:string|null;holdings:{symbol:string;tokens:string|null}[]}|null};

export default function OwnerSale({provider,address,safe,wallet,assets,usdg,onComplete}:{provider:WalletProvider|null;address:string;safe:string;wallet:'current'|'previous';assets:{symbol:string;quantity:string|null}[];usdg:string|null;onComplete:()=>void}){
 const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[hash,setHash]=useState(''),[message,setMessage]=useState('');
 async function getDraft(symbol:string){const response=await fetch('/api/workspace/wallets/previous/sell',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,wallet}),cache:'no-store',signal:AbortSignal.timeout(45000)});const body=await response.json() as Draft&{error?:string};if(!response.ok)throw Error(body.error??'Sell quote unavailable.');if(!body.simulated||body.owner.toLowerCase()!==address.toLowerCase()||body.safe.toLowerCase()!==safe.toLowerCase())throw Error('The sell review did not match your wallet.');return body;}
 async function review(symbol:string){setBusy(true);setError('');setMessage('');setDraft(null);try{if(!provider)throw Error('Connect your owner wallet first.');await matchingWallet(provider,address);setDraft(await getDraft(symbol));}catch(cause){setError(cause instanceof Error?cause.message:'Sell review unavailable.');}finally{setBusy(false);}}
 async function submit(){if(!provider||!draft||busy||hash)return;setBusy(true);setError('');setMessage('');try{
  await matchingWallet(provider,address);
  const renewed=await getDraft(draft.symbol);
  if(renewed.quantity!==draft.quantity||renewed.minimumUsdgRaw!==draft.minimumUsdgRaw){setDraft(renewed);throw Error('The price or balance changed. Review the new minimum before signing.');}
  if(Date.parse(renewed.expiresAt)<=Date.now()+2000)throw Error('The quote expired. Review a new quote.');
  const sent=await provider.request({method:'eth_sendTransaction',params:[renewed.transaction]});
  if(typeof sent!=='string'||!/^0x[0-9a-f]{64}$/i.test(sent))throw Error('Your wallet did not return a transaction hash. Check its activity before trying again.');
  setHash(sent);setDraft(null);setMessage('Sale sent. Checking confirmation; do not send it again.');
  let receipt:{status?:string}|null=null;
  for(let attempt=0;attempt<40;attempt++){await new Promise(resolve=>setTimeout(resolve,3000));try{const response=await fetch('https://rpc.mainnet.chain.robinhood.com/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getTransactionReceipt',params:[sent]}),signal:AbortSignal.timeout(5000)});const body=await response.json() as {result?:{status?:string}|null};if(body.result){receipt=body.result;break;}}catch{/* Keep checking the submitted hash. */}}
  if(!receipt)throw Error('Confirmation is still unknown. Check the transaction in the explorer; do not send it again.');
  if(receipt.status!=='0x1')throw Error('The transaction failed. Check the explorer before trying again.');
  const response=await fetch(`/api/workspace/wallets/previous${wallet==='current'?'?wallet=current':''}`,{cache:'no-store',signal:AbortSignal.timeout(20000)});
  const body=await response.json() as Wallet;
  const afterStock=body.wallet?.holdings.find(item=>item.symbol===renewed.symbol)?.tokens;
  const afterUsdg=body.wallet?.usdg;
  if(!response.ok||afterStock===null||afterStock===undefined||afterUsdg===null||afterUsdg===undefined||usdg===null||parseUnits(afterStock,18)>=parseUnits(renewed.quantity,18)||parseUnits(afterUsdg,6)<=parseUnits(usdg,6)){
   setMessage('Transaction confirmed, but the new balances could not be verified yet. Check the explorer and refresh your wallet. Do not send it again.');
  }else{setMessage(`Sale confirmed. ${renewed.symbol} decreased and USDG increased in your Steward wallet.`);onComplete();}
 }catch(cause){setError(cause instanceof Error?cause.message:'Sale status is unknown. Check wallet activity before trying again.');}finally{setBusy(false);}}
 const stocks=assets.filter(asset=>asset.symbol!=='USDG'&&asset.quantity!==null&&parseUnits(asset.quantity,18)>0n);
 if(!stocks.length)return null;
 return <div className="ws-previous-recovery"><div><strong>Sell a holding for USDG</strong><p>Review a live quote for your entire holding. The trade stays in your Steward wallet; you approve the exact sale in your own wallet.</p></div>
  <div className="ws-previous-recovery-assets">{stocks.map(asset=><button key={asset.symbol} type="button" disabled={!provider||busy||Boolean(hash)} onClick={()=>void review(asset.symbol)}>Review {asset.symbol} sale</button>)}</div>
  {draft&&<div className="ws-previous-recovery-review"><span>SELL REVIEW · WALLET APPROVAL DEADLINE {new Date(draft.expiresAt).toLocaleTimeString()}</span><strong>Sell {draft.quantity} {draft.symbol}</strong><p>Estimated return: {draft.estimatedUsdg} USDG<br/>Minimum you will receive: <strong>{draft.minimumUsdg} USDG</strong><br/>The quote is refreshed when you press Approve. USDG stays in your Steward wallet. Your connected wallet pays the network fee.</p><div><button type="button" disabled={busy} onClick={()=>void submit()}>Review and approve in wallet</button><button type="button" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button></div></div>}
  {message&&<p role="status">{message}</p>}{error&&<p role="alert" className="ws-previous-recovery-error">{error}</p>}{hash&&<a href={`https://robinhoodchain.blockscout.com/tx/${hash}`} target="_blank" rel="noopener noreferrer">View sale transaction ↗</a>}
 </div>;
}
