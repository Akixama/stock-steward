'use client';
import {useEffect,useState} from 'react';
import {parseUnits} from 'viem';
import {matchingWallet,type WalletProvider} from '@/lib/browser-wallet';
import OrderStatusTimeline from './order-status-timeline';

type Draft={symbol:string;safe:string;owner:string;quantity:string;estimatedUsdg:string;minimumUsdg:string;minimumUsdgRaw:string;expiresAt:string;gasEstimate:string;transaction:{from:string;to:string;value:string;data:string};attemptId:string|null;simulated:boolean};
type Wallet={wallet:{usdg:string|null;holdings:{symbol:string;tokens:string|null}[]}|null};

export default function OwnerSale({provider,address,safe,wallet,assets,usdg,onComplete}:{provider:WalletProvider|null;address:string;safe:string;wallet:'current'|'previous';assets:{symbol:string;quantity:string|null}[];usdg:string|null;onComplete:()=>void}){
 const [draft,setDraft]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[hash,setHash]=useState(''),[message,setMessage]=useState('');
 useEffect(()=>{let active=true;void fetch(`/api/workspace/wallets/previous/action-receipt?kind=sell&safe=${encodeURIComponent(safe)}`,{cache:'no-store'}).then(r=>r.json() as Promise<{latest?:{id:string;kind:string;safe:string;hash:string|null;state:string}}>).then(async body=>{const latest=body.latest;if(!active||latest?.kind!=='sell'||latest.safe.toLowerCase()!==safe.toLowerCase()||!latest.hash)return;setHash(latest.hash);setMessage('Last sale hash is saved. Checking its chain receipt.');const response=await fetch('/api/workspace/wallets/previous/action-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:latest.id,hash:latest.hash}),cache:'no-store'});const receipt=await response.json() as {notice?:string};if(active&&receipt.notice)setMessage(receipt.notice);}).catch(()=>{});return()=>{active=false;};},[safe]);
 async function getDraft(symbol:string,commit=false){const response=await fetch('/api/workspace/wallets/previous/sell',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbol,wallet,commit,...(commit&&draft?{expectedQuantity:draft.quantity,expectedMinimumUsdgRaw:draft.minimumUsdgRaw}:{})}),cache:'no-store',signal:AbortSignal.timeout(45000)});const body=await response.json() as Draft&{error?:string};if(!response.ok)throw Error(body.error??'Sell quote unavailable.');if(!body.simulated||body.owner.toLowerCase()!==address.toLowerCase()||body.safe.toLowerCase()!==safe.toLowerCase())throw Error('The sell review did not match your wallet.');return body;}
 async function review(symbol:string){setBusy(true);setError('');setMessage('');setDraft(null);try{if(!provider)throw Error('Connect your owner wallet first.');await matchingWallet(provider,address);setDraft(await getDraft(symbol));}catch(cause){setError(cause instanceof Error?cause.message:'Sell review unavailable.');}finally{setBusy(false);}}
 async function submit(){if(!provider||!draft||busy||hash)return;setBusy(true);setError('');setMessage('');try{
  await matchingWallet(provider,address);
  const renewed=await getDraft(draft.symbol,true);
  if(!renewed.attemptId)throw Error('The sale attempt was not saved. No wallet request was made.');
  if(renewed.quantity!==draft.quantity||renewed.minimumUsdgRaw!==draft.minimumUsdgRaw){setDraft(null);throw Error('The price or balance changed. Check your saved attempt before trying again.');}
  if(Date.parse(renewed.expiresAt)<=Date.now()+2000)throw Error('The quote expired. Review a new quote.');
  const gate=await fetch('/api/workspace/trading-check',{cache:'no-store'});if(!gate.ok)throw Error('Trading is paused. No wallet request was made.');
  const sent=await provider.request({method:'eth_sendTransaction',params:[renewed.transaction]});
  if(typeof sent!=='string'||!/^0x[0-9a-f]{64}$/i.test(sent))throw Error('Your wallet did not return a transaction hash. Check its activity before trying again.');
  setHash(sent);setDraft(null);setMessage('Sale sent. Checking confirmation; do not send it again.');
  const saved=await fetch('/api/workspace/wallets/previous/action-receipt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:renewed.attemptId,hash:sent}),cache:'no-store'});if(!saved.ok)throw Error('Sale was sent, but its hash could not be saved. Keep the explorer link and do not send again.');
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
  {draft&&<div className="ws-previous-recovery-review"><span>SELL REVIEW</span><strong>Sell {draft.quantity} {draft.symbol}</strong><dl className="ws-exact-order-facts"><div><dt>Amount to sell</dt><dd>{draft.quantity} {draft.symbol}</dd></div><div><dt>Estimated return</dt><dd>{draft.estimatedUsdg} USDG</dd></div><div><dt>Minimum output</dt><dd>{draft.minimumUsdg} USDG</dd></div><div><dt>Network fee estimate</dt><dd>Shown in your wallet before approval</dd></div><div><dt>Wallet approval deadline</dt><dd>{new Date(draft.expiresAt).toLocaleTimeString()}</dd></div></dl><p>The return is an estimate. The quote is refreshed when you press Approve. USDG stays in your Steward wallet. Your connected wallet pays the network fee.</p><div><button type="button" disabled={busy} onClick={()=>void submit()}>Review and approve in wallet</button><button type="button" disabled={busy} onClick={()=>setDraft(null)}>Cancel</button></div></div>}
  {hash&&<OrderStatusTimeline stage={message.startsWith('Sale confirmed.')?'verified':message.startsWith('Transaction confirmed')?'confirming':'submitted'}/>}{message&&<p role="status">{message}</p>}{error&&<p role="alert" className="ws-previous-recovery-error">{error}</p>}{hash&&<a href={`https://robinhoodchain.blockscout.com/tx/${hash}`} target="_blank" rel="noopener noreferrer">View sale transaction ↗</a>}
 </div>;
}
