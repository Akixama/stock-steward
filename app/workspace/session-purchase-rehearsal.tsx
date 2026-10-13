'use client';
import {useEffect,useRef,useState} from 'react';
import {formatEther,toHex} from 'viem';
import {matchingWallet,type WalletProvider} from '@/lib/browser-wallet';
type Intent={id:string;message:string;expiresAt:string;inputRaw:string;side:'buy'|'sell';inputAmount:string;inputSymbol:string;maximumGasCostWei:string};
export default function SessionPurchaseRehearsal({provider,address}:{provider:WalletProvider|null;address:string}){
 const [intent,setIntent]=useState<Intent|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[now,setNow]=useState(Date.now);const generation=useRef(0);
 useEffect(()=>{generation.current++;const timer=setTimeout(()=>{setIntent(null);setBusy(false);setNotice('');setError('');},0);return()=>{clearTimeout(timer);generation.current++;};},[provider,address]);
 useEffect(()=>{if(!intent)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[intent]);
 async function action(kind:'prepare'|'submit'|'status'){
  if(busy)return;const ticket=++generation.current;setBusy(true);setError('');
  try{
   if(kind==='status'){const r=await fetch('/api/workspace/autonomy/rehearsal',{cache:'no-store'}),b=await r.json() as {error?:string;intents:{state:string;transaction_hash:string|null;receipt_state?:string|null}[]};if(!r.ok)throw Error(b.error);if(ticket===generation.current)setNotice(b.intents.length?b.intents.map((i:{state:string;transaction_hash:string|null;receipt_state?:string|null})=>`${i.receipt_state??i.state}${i.transaction_hash?` · ${i.transaction_hash}`:''}`).join('\n'):'No session trade submitted.');return;}
   let payload:object={action:'prepare'};
   if(kind==='submit'){
    if(!provider||!intent||Date.parse(intent.expiresAt)<=Date.now())throw Error('Prepare a fresh trade first.');
    await matchingWallet(provider,address);if(ticket!==generation.current)return;
    const signature=await provider.request({method:'personal_sign',params:[toHex(intent.message),address]});
    if(ticket!==generation.current)return;if(typeof signature!=='string')throw Error('Owner signature unavailable.');
    await matchingWallet(provider,address);if(ticket!==generation.current)return;
    payload={action:'submit',id:intent.id,signature};setIntent(null);
   }
   const r=await fetch('/api/workspace/autonomy/rehearsal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),b=await r.json() as Intent & {error?:string;why?:string;hash?:string};if(!r.ok)throw Error(b.error??'Purchase review unavailable.');
   if(ticket!==generation.current)return;if(kind==='prepare'){setIntent(b);setNotice('Review this single real trade before signing. Quotes expire quickly.');}else setNotice(`${b.why}${b.hash?` Transaction: ${b.hash}`:''}`);
  }catch(e){if(ticket===generation.current)setError(e instanceof Error?e.message:'Check trade status before retrying.');}finally{if(ticket===generation.current)setBusy(false);}
 }
 const remaining=intent?Math.max(0,Math.ceil((Date.parse(intent.expiresAt)-now)/1000)):0;
 return <section className="ws-shadow-agent" aria-busy={busy}><span className="ws-label">ONE TRADE · REAL FUNDS</span><h3>Test your session.</h3><p>Requires verified reviews, permission, funding and a fee limit. This trade does not start automatic trading.</p><div className="ws-chain-tools"><button className="ws-recheck" disabled={busy||!provider} onClick={()=>action('prepare')}>{busy?'Checking…':'Prepare one trade'}</button><button className="ws-recheck" disabled={busy} onClick={()=>action('status')}>Check submitted trades</button></div>{intent&&<div className="ws-session-trade"><dl><div><dt>{intent.side==='sell'?'Tokens to sell':'Payment'}</dt><dd>{intent.inputAmount} {intent.inputSymbol}</dd></div><div><dt>Maximum network fee</dt><dd>{formatEther(BigInt(intent.maximumGasCostWei))} ETH</dd></div><div><dt>Quote</dt><dd role="timer">{remaining?`${remaining}s remaining`:'Expired · prepare again'}</dd></div></dl><details><summary>Exact approval message</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{intent.message}</pre></details><button className="ws-action-secondary" disabled={busy||!provider||remaining===0} onClick={()=>action('submit')}>Approve this trade</button></div>}{notice&&<p role="status" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{notice}</p>}{error&&<p role="alert" className="ws-error">{error}</p>}<p className="ws-session-footnote">Missing response? Check submitted trades before trying anything else.</p></section>;
}
