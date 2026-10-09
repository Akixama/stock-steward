import type {Metadata} from 'next';
import { RouteLink } from "@/components/route-transition";
import {ArrowLeft,ArrowRight,Eye,LockKeyhole,ShieldCheck} from 'lucide-react';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {alpacaConfigured,alpacaEnvironment,alpacaOrderSubmissionEnabled} from '@/lib/alpaca-connection';
import {BrandMark,BrandName} from '@/components/brand';
import './connect.css';

export const metadata:Metadata={title:'Broker connection · Stock Steward'};
export const dynamic='force-dynamic';

export default async function ConnectPage({searchParams}:{searchParams:Promise<{intent?:string;broker?:string}>}){
  const params=await searchParams;
  const trading=params.intent==='trading';
  const connectionStatus=params.broker==='invalid_state'?'Your connection session expired or was replaced. Start again here and complete the Alpaca review in this browser tab.':params.broker==='failed'?'Alpaca access could not be verified. No connection was saved. Start again to retry.':params.broker==='denied'?'No broker connection was made. You can start again whenever you are ready.':null;
  const user=await getChatGPTUser();
  const configured=alpacaConfigured();
  const tradingEnabled=configured&&alpacaOrderSubmissionEnabled(alpacaEnvironment());
  const canContinue=!!user&&configured&&(!trading||tradingEnabled);
  return <div className="connect-page"><div className="connect-shell">
    <header className="connect-header"><RouteLink className="connect-brand" href="/"><BrandMark/><BrandName/></RouteLink><RouteLink className="connect-back" href="/workspace"><ArrowLeft size={16}/> Workspace</RouteLink></header>
    <main className="connect-main">
      <div className="connect-intro"><span className="connect-kicker">BROKER CONNECTION / YOUR CONSENT</span>
        {connectionStatus&&<p className="connect-status" role="status">{connectionStatus}</p>}
        <h1>{trading?<>A separate choice<br/><em>to place orders.</em></>:<>See your account.<br/><em>Keep control.</em></>}</h1>
        <p>{trading?tradingEnabled?'Trading access lets Stock Steward submit one exact order only after you review and approve it yourself. It is a separate permission from read-only access.':'Trading access would let Stock Steward submit an exact order only after you review and approve it. It is not enabled in this deployment.':configured?'With your Alpaca consent, Stock Steward can read account evidence to check a proposed purchase against your saved limits.':'A future Alpaca connection will let Stock Steward read your account evidence so it can check a proposed purchase against your saved limits. The current deployment has no live broker connection.'}</p>
        <div className="connect-steps"><span className={!trading?'active':''}>01 · Read account</span><span className={trading?'active':''}>02 · Separate trading permission</span><span>03 · Explain every decision</span></div>
      </div>
      <section className="connect-panel" aria-labelledby="connect-panel-title"><div className="connect-panel-head">{trading?<LockKeyhole size={17}/>:<Eye size={17}/>}<span>{trading?(tradingEnabled?'TRADING PERMISSION / AVAILABLE':'TRADING PERMISSION / NOT AVAILABLE'):'DATA ACCESS REQUEST / PREVIEW'}</span></div>
        <div className="connect-panel-body"><h2 id="connect-panel-title">{trading?'Order access needs its own approval.':'What Stock Steward would read.'}</h2>
          <p>{trading?tradingEnabled?'Stock Steward requests Alpaca trading scope with your consent. Every proposed order is checked against your saved mandate and needs your approval of the exact symbol and dollar amount before anything is submitted.':'Trading scope stays off until the deployment enables it. Every proposed order would still be checked against your saved mandate and require your approval of the exact symbol and dollar amount.':'With your Alpaca consent, Stock Steward would read your account, positions, open orders, fills, asset status and stock quotes. It would use these facts to check your rules and save a receipt explaining why a proposal was held or allowed.'}</p>
          <div className="connect-permissions"><div><span>ACCOUNT DATA</span><strong>{trading?'Continues from read access':'Requested only with your consent'}</strong></div><div><span>ORDER SUBMISSION</span><strong>{trading?(tradingEnabled?'Enabled — each order needs your approval':'Unavailable in this deployment'):'Not requested'}</strong></div><div><span>FUNDS & WALLET</span><strong>No transfer or wallet permission</strong></div></div>
          <p className="connect-detail"><ShieldCheck size={17}/><span>{trading?'A trading grant would not bypass saved limits or exact-order approval. You can disconnect the broker connection from your workspace.':'Practice uses fake funds. Viewing this page does not contact Alpaca, connect an account or place an order.'}</span></p>
          {!trading&&<p className="connect-consent-note"><strong>Check Alpaca’s wording before allowing access.</strong> Its current paper-account consent page mentions transaction authority even for this data-only request. Stock Steward rejects a trading grant from this flow, and order submission is disabled.</p>}
        </div>
        <div className="connect-panel-foot"><p>{!user?'Sign in before connecting your own account.':!configured?'Alpaca app approval and credentials are pending.':trading&&!tradingEnabled?'Trading access is disabled.':'Continue to Alpaca to review the requested data scope.'}</p>
          {canContinue?<form method="post" action={`/api/broker/alpaca/start${trading?'?intent=trading':''}`}><button type="submit">Review at Alpaca <ArrowRight size={16}/></button></form>:<button type="button" disabled>{trading?'Trading unavailable':'Connection pending'}</button>}
        </div>
      </section>
    </main>
    <footer className="connect-footer"><span><LockKeyhole size={14}/> Stock Steward is independent of Alpaca. No brokerage endorsement is claimed.</span><div className="connect-footer-links"><RouteLink href={trading?'/connect':'/connect?intent=trading'}>{trading?'Read-only access':'See separate trading access'} <ArrowRight size={13}/></RouteLink><RouteLink href="/privacy">Privacy</RouteLink><RouteLink href="/terms">Terms</RouteLink></div></footer>
  </div></div>;
}
