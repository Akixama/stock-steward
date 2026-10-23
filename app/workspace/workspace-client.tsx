"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ArrowRight, ArrowUpRight, Check, CircleDot, Clock3,
  LockKeyhole, RotateCcw, ShieldCheck, SlidersHorizontal, Play, BellRing,
} from "lucide-react";
import { BrandMark, BrandName } from "@/components/brand";
import {flushSync} from 'react-dom';
import { RouteLink } from "@/components/route-transition";
import type { Mandate } from "@/lib/decision";
import OverviewMotion from './overview-motion';
import GoalPanel from './goal-panel';
import AlertsPanel from './alerts-panel';
import PracticeTrail from './practice-trail';
import ChainPanel from "./chain-panel";
import StrategyPanel from './strategy-panel';
import AutomaticPanel from './automatic-panel';
import WalletOrdersPanel from "./wallet-orders-panel";
import { useWalletSession } from "./wallet-session";
import StockSelector from './stock-selector';
import "./workspace.css";
import "./workspace-redesign.css";
import "./workspace-v2.css";
import "./workspace-v3.css";
import "./workspace-v4.css";
import "./workspace-v5.css";

type View = "overview" | "goal" | "mandate" | "trail" | "strategy" | "practice" | "alerts";
const initial: Mandate = {
  version: 0, allowedSymbols: [], maxOrderCents: 10_000,
  maxDailyBuyCents: 25_000, maxPositionBps: 1_500, requireApproval: true,
  executionPreference: "approval",
};
const oldDeviceStore = "stock-steward-brokerage-mandate-v1";
const usd = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(cents / 100);
export default function WorkspaceClient({initialMandate,storageError,publicMode}:{initialMandate:Mandate|null;storageError:string|null;publicMode:boolean}) {
  const walletSession = useWalletSession();
  const mainRef=useRef<HTMLElement|null>(null),navRef=useRef<HTMLElement|null>(null),motion=useRef<Animation|null>(null),navigation=useRef(0);
  const [indicator,setIndicator]=useState({left:5,width:0});
  const [view, setView] = useState<View>("overview");
  const [unreadAlerts, setUnreadAlerts] = useState<number | null>(null);
  useEffect(()=>{const requested=new URLSearchParams(window.location.search).get('view');if(requested!=='alerts'&&requested!=='mandate'&&requested!=='strategy')return;const timer=setTimeout(()=>setView(requested),0);return()=>clearTimeout(timer);},[]);
  useEffect(()=>{const url=new URL(window.location.href);if(url.searchParams.get('review')!=='buy')return;url.searchParams.delete('review');window.history.replaceState(null,'',url.pathname+url.search);const timer=window.setTimeout(()=>window.dispatchEvent(new Event('stock-steward:open-buy')),500);return()=>window.clearTimeout(timer);},[]);
  useEffect(()=>{let active=true;const refresh=async()=>{try{const response=await fetch('/api/workspace/notifications',{cache:'no-store'});const data=await response.json() as {unread?:number};if(active&&response.ok&&typeof data.unread==='number')setUnreadAlerts(data.unread);}catch{}};void refresh();const timer=window.setInterval(()=>void refresh(),60000);return()=>{active=false;window.clearInterval(timer);};},[]);
  useEffect(()=>{const nav=navRef.current;if(!nav)return;const measure=()=>{const selected=nav.querySelector<HTMLButtonElement>('button.selected');if(selected)setIndicator({left:selected.offsetLeft,width:selected.offsetWidth});};measure();const observer=new ResizeObserver(measure);observer.observe(nav);return()=>observer.disconnect();},[view]);
  useEffect(()=>()=>{navigation.current++;motion.current?.cancel();},[]);
  const [animateView, setAnimateView] = useState(true);
  const [mandate, setMandate] = useState<Mandate>(initialMandate ?? initial);
  const [symbols, setSymbols] = useState(initialMandate?.allowedSymbols.join(", ") ?? "");
  const [maxOrder, setMaxOrder] = useState(String((initialMandate ?? initial).maxOrderCents / 100));
  const [maxDaily, setMaxDaily] = useState(String((initialMandate ?? initial).maxDailyBuyCents / 100));
  const [maxPosition, setMaxPosition] = useState(String((initialMandate ?? initial).maxPositionBps / 100));
  const [executionPreference, setExecutionPreference] = useState<"approval" | "automatic">(initialMandate?.executionPreference ?? "approval");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [legacyDraft, setLegacyDraft] = useState(false);
  const [overviewState, setOverviewState] = useState({ ownership: false, permission: false, funded: false, bought: false, receiptVerified: false, limitIssue: '' as '' | 'expired' | 'invalid' });
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const [ownershipResponse, orderResponse] = await Promise.all([
          fetch('/api/workspace/ownership', { cache: 'no-store' }),
          fetch('/api/workspace/orders/live/status', { cache: 'no-store' }),
        ]);
        const ownership = await ownershipResponse.json() as { ownership?: { address?: string; verifiedAt?: string } | null };
        const order = await orderResponse.json() as { permissionActive?: boolean; blocked?: string; detail?: string; balanceCents?: number | null; perTradeCents?: number; latestOrder?: { state?: string } | null };
        if (active) setOverviewState({
          ownership: Boolean(walletSession && ownership.ownership?.verifiedAt && ownership.ownership.address?.toLowerCase() === walletSession.address.toLowerCase()),
          permission: order.permissionActive === true,
          funded: order.permissionActive === true && Number.isFinite(order.perTradeCents) && Number(order.balanceCents ?? 0) >= Number(order.perTradeCents),
          bought: Boolean(order.latestOrder && order.latestOrder.state !== 'reverted'),
          receiptVerified: order.latestOrder?.state === 'confirmed',
          limitIssue: order.blocked === 'limits' ? /permission window ended/i.test(order.detail ?? '') ? 'expired' : 'invalid' : '',
        });
      } catch { /* The detailed cards below retain their own error states. */ }
    };
    void read();
    const refresh = () => void read();
    window.addEventListener('stock-steward:ownership-changed', refresh);
    window.addEventListener('steward-permission-updated', refresh);
    window.addEventListener('steward-order-updated', refresh);
    return () => { active = false; window.removeEventListener('stock-steward:ownership-changed', refresh); window.removeEventListener('steward-permission-updated', refresh); window.removeEventListener('steward-order-updated', refresh); };
  }, [walletSession]);
  useEffect(() => {
    if (initialMandate) return;
    try {
      const raw = localStorage.getItem(oldDeviceStore);
      if (!raw) return;
      const previous = JSON.parse(raw) as Partial<Mandate>;
      if (previous.requireApproval !== true || !Array.isArray(previous.allowedSymbols) ||
        !previous.allowedSymbols.every((value) => typeof value === "string") ||
        !Number.isSafeInteger(previous.maxOrderCents) || !Number.isSafeInteger(previous.maxDailyBuyCents) ||
        !Number.isSafeInteger(previous.maxPositionBps)) return;
      const timer = window.setTimeout(() => {
        setSymbols(previous.allowedSymbols!.join(", "));
        setMaxOrder(String(previous.maxOrderCents! / 100));
        setMaxDaily(String(previous.maxDailyBuyCents! / 100));
        setMaxPosition(String(previous.maxPositionBps! / 100));
        setLegacyDraft(true);
      }, 0);
      return () => window.clearTimeout(timer);
    } catch { /* An invalid old device preference does not replace server state. */ }
  }, [initialMandate]);

  const allowedSymbols = [...new Set(symbols.toUpperCase().split(/[\s,]+/).filter(Boolean))];
  const orderCents = Math.round(Number(maxOrder) * 100);
  const dailyCents = Math.round(Number(maxDaily) * 100);
  const positionBps = Math.round(Number(maxPosition) * 100);
  const valid = allowedSymbols.length <= 3 && allowedSymbols.every((symbol) => /^[A-Z.]{1,8}$/.test(symbol)) &&
    [maxOrder, maxDaily, maxPosition].every((value) => value.trim() !== "" && Number.isFinite(Number(value))) &&
    Number(maxOrder) >= 0.01 && Number(maxDaily) >= Number(maxOrder) && Number(maxDaily) <= 1_000_000 &&
    Number(maxPosition) > 0 && Number(maxPosition) <= 100;
  const dirty = mandate.version === 0 || allowedSymbols.join(",") !== mandate.allowedSymbols.join(",") ||
    orderCents !== mandate.maxOrderCents || dailyCents !== mandate.maxDailyBuyCents ||
    positionBps !== mandate.maxPositionBps || executionPreference !== (mandate.executionPreference ?? "approval");

  function navigate(next: View, event?: MouseEvent<HTMLButtonElement>) {
    navigation.current++;motion.current?.cancel();if(next===view)return;
    const enabled=(!event||event.detail!==0)&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const order=['overview','goal','mandate','alerts','strategy','practice','trail'];
    const direction=order.indexOf(next)>order.indexOf(view)?1:-1;
    setAnimateView(enabled);flushSync(()=>setView(next));window.scrollTo(0,0);
    const panel=mainRef.current;
    if(enabled&&panel)motion.current=panel.animate([{opacity:.7,transform:'translateX('+(direction*12)+'px)'},{opacity:1,transform:'translateX(0)'}],{duration:200,easing:'cubic-bezier(.23,1,.32,1)'});
  }

  function resetDraft() {
    setSymbols(mandate.allowedSymbols.join(", "));
    setMaxOrder(String(mandate.maxOrderCents / 100));
    setMaxDaily(String(mandate.maxDailyBuyCents / 100));
    setMaxPosition(String(mandate.maxPositionBps / 100));
    setExecutionPreference(mandate.executionPreference ?? "approval");
    setSaveError(null);
    setSaved(false);
    if (legacyDraft) {
      localStorage.removeItem(oldDeviceStore);
      setLegacyDraft(false);
    }
  }

  async function saveMandate() {
    if (!valid || !dirty || saving || storageError) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/workspace/mandate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseVersion: mandate.version, allowedSymbols,
          maxOrderCents: orderCents, maxDailyBuyCents: dailyCents, maxPositionBps: positionBps, executionPreference,
        }),
      });
      const result = await response.json() as { mandate?: Mandate; error?: string };
      if (!response.ok || !result.mandate) throw new Error(result.error ?? "Could not save your mandate.");
      setMandate(result.mandate);
      if (legacyDraft) {
        localStorage.removeItem(oldDeviceStore);
        setLegacyDraft(false);
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2800);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save your mandate.");
    } finally {
      setSaving(false);
    }
  }

  const limitsReady = Boolean(mandate.version) && overviewState.limitIssue!=='invalid';
  // Expiry calls for Renew on the existing wallet, not the first-time setup stepper.
  const setupComplete=limitsReady&&overviewState.ownership&&(overviewState.permission||overviewState.limitIssue==='expired');
  const completedSteps = [limitsReady, overviewState.ownership, overviewState.permission||overviewState.limitIssue==='expired'].filter(Boolean).length;

  return <div className="ws">
    <header className="ws-header">
      <RouteLink href="/" className="ws-brand" aria-label="Stock Steward home"><BrandMark /><BrandName /></RouteLink>
      <div className="ws-header-actions">
        <span className="ws-header-caption">PRIVATE WORKSPACE</span>
        <RouteLink href="/chart" className="ws-guide-link">Markets <ArrowUpRight size={15} /></RouteLink>
        <RouteLink href="/guide" className="ws-guide-link">Guide <ArrowUpRight size={15} /></RouteLink>
      </div>
    </header>

    <div className="ws-shell">
      <div className="ws-toolbar">
        <div className="ws-toolbar-title"><span className="ws-toolbar-orb" aria-hidden="true" /><span>Steward / Workspace</span></div>
        <nav ref={navRef} className="ws-nav" aria-label="Workspace views"><span className="ws-nav-indicator" aria-hidden="true" style={{opacity:indicator.width?1:0,width:indicator.width,transform:"translateX("+indicator.left+"px)"}}/>
          <button type="button" className={view === "overview" ? "selected" : ""} aria-current={view === "overview" ? "page" : undefined} onClick={(event) => navigate("overview", event)}><CircleDot size={16} />Overview</button>
          <button type="button" className={view === "goal" ? "selected" : ""} aria-current={view === "goal" ? "page" : undefined} onClick={event=>navigate('goal',event)}><CircleDot size={16}/>My plan</button>
          <button type="button" className={view === "mandate" ? "selected" : ""} aria-current={view === "mandate" ? "page" : undefined} onClick={(event) => navigate("mandate", event)}><SlidersHorizontal size={16} />Limits</button>
          <button type="button" className={view === "alerts" ? "selected" : ""} aria-current={view === "alerts" ? "page" : undefined} onClick={event=>navigate('alerts',event)}><BellRing size={16}/>Alerts{unreadAlerts!==null&&unreadAlerts>0&&<b className="ws-unread-badge" aria-label={`${unreadAlerts} unread alerts`}>{unreadAlerts>99?'99+':unreadAlerts}</b>}</button>
          <button type="button" className={view === "strategy" ? "selected" : ""} aria-current={view === "strategy" ? "page" : undefined} onClick={event=>navigate('strategy',event)}><ShieldCheck size={16}/>Strategy</button>
          <button type="button" className={view === "practice" ? "selected" : ""} aria-current={view === "practice" ? "page" : undefined} onClick={event=>navigate('practice',event)}><Play size={16}/>Practice</button>
          <button type="button" className={view === "trail" ? "selected" : ""} aria-label="Decision trail" aria-current={view === "trail" ? "page" : undefined} onClick={(event) => navigate("trail", event)}><Clock3 size={16} />Trail</button>
        </nav>
      </div>

      <main ref={mainRef} className="ws-main">
        {storageError && <p className="ws-error" role="alert">{storageError}</p>}
        <div hidden={view!=='strategy'&&view!=='practice'} className="ws-view" data-animate={(view==='strategy'||view==='practice')&&animateView}><StrategyPanel mandate={mandate} surface={view==='practice'?'practice':'strategy'} onSetBoundaries={()=>navigate('mandate')} onOverview={()=>navigate('overview')} onStrategy={()=>navigate('strategy')} onPractice={()=>navigate('practice')} onTrail={()=>navigate('trail')}/>{view==='strategy'&&<AutomaticPanel mandate={mandate} onReviewBuy={()=>{navigate('overview');window.setTimeout(()=>window.dispatchEvent(new Event('stock-steward:open-buy')),0);}}/>}</div>
        {view === 'goal' && <GoalPanel mandateVersion={mandate.version} onLimits={()=>navigate('mandate')} onPractice={()=>navigate('practice')}/>}
        {view === 'alerts' && <div className="ws-view" data-animate={animateView} key="alerts"><div className="ws-page-head"><div><span className="ws-eyebrow">ALERTS</span><h1>Watch prices.<br/><em>Stay informed.</em></h1><p>Your inbox works in the app without setup. Optional device notifications can reach you while the site is closed. Alerts never place orders.</p></div></div><AlertsPanel mandate={mandate} onCount={setUnreadAlerts} onReviewBuy={()=>{navigate('overview');window.setTimeout(()=>window.dispatchEvent(new Event('stock-steward:open-buy')),0);}}/></div>}
        {view === "overview" && <div className="ws-view ws-v2-overview" data-animate={animateView} key="overview">
          <WalletOrdersPanel mandate={mandate} onOpenMandate={() => navigate("mandate")} publicMode={publicMode} progress={{done:completedSteps,total:3,complete:setupComplete,next:!limitsReady?'Set your buying limits':!overviewState.ownership?'Connect and verify your wallet':'Activate buying permission',action:!limitsReady?'limits':'setup'}} />
          <details className="ws-v2-more"><summary>More wallet details</summary><ChainPanel mandate={mandate} /></details>
        </div>}
        {view === "mandate" && <div className="ws-view" data-animate={animateView} key="mandate">
          <div className="ws-page-head"><div><span className="ws-eyebrow">YOUR LIMITS</span><h1>Decide the limits.<br /><em>Keep the control.</em></h1><p>Choose which stocks you can buy and how much you can spend. Saving alone does not buy anything.</p></div><OverviewMotion variant="mandate" caption={mandate.version ? "LIMITS SAVED" : "UNSAVED DRAFT"}/></div>
          {legacyDraft && <p className="ws-import-note">Earlier device-only limits were found. Review these fields, then save to move them into your signed-in workspace.</p>}
          <div className="ws-mandate-grid">
            <section className="ws-editor">
              <div className="ws-editor-intro"><span className="ws-label">PURCHASE LIMITS</span><h2>Choose what works for you.</h2></div>
              <div className="ws-fields">
                <StockSelector selected={allowedSymbols} onChange={(next) => setSymbols(next.join(', '))} />
                <label className="ws-field"><span>Most per buy</span><div className="ws-input-unit"><b>$</b><input type="number" min="0.01" step="0.01" value={maxOrder} onChange={(event) => setMaxOrder(event.target.value)} /></div></label>
                <label className="ws-field"><span>Most per day</span><div className="ws-input-unit"><b>$</b><input type="number" min="0.01" step="0.01" value={maxDaily} onChange={(event) => setMaxDaily(event.target.value)} /></div><small>Across two days, that is {Number.isFinite(dailyCents)?usd(dailyCents*2):'—'}.</small></label>
                <label className="ws-field ws-field-wide"><span>Most you can hold in one stock</span><div className="ws-input-unit"><input type="number" min="0" max="100" step="0.1" value={maxPosition} onChange={(event) => setMaxPosition(event.target.value)} /><b>%</b></div><small>0 to 100% of the account value.</small></label>
                <div className="ws-order-rule"><span className="ws-label">HOW ORDERS WORK</span><strong>{executionPreference === "approval" ? "You approve every real purchase" : "Buying is turned off"}</strong><p>{executionPreference === "approval" ? "Steward checks your limits first. You review and sign each exact order in your wallet. Use Practice to try decisions with simulated funds." : "This older setting blocks real buys. Switch to wallet approval and save your limits to buy."}</p>{executionPreference === "automatic" && <button type="button" onClick={() => setExecutionPreference("approval")}>Use wallet approval <ArrowRight size={16} /></button>}</div>
              </div>
              <div className="ws-editor-footer"><div className="ws-save-status"><span className={dirty ? "ws-dirty-dot" : "ws-clean-dot"} /><div><strong>{dirty ? "Unsaved changes" : mandate.version ? "Limits saved" : "No saved limits yet"}</strong><small>{dirty ? "You will need to approve these changes in your wallet before buying." : "Saving limits alone does not turn on buying."}</small></div></div><div className="ws-editor-actions">{dirty && mandate.version > 0 && <button type="button" className="ws-reset" onClick={resetDraft}><RotateCcw size={15} />Reset draft</button>}<button type="button" className={saved && !dirty ? "ws-save is-saved" : "ws-save"} onClick={saveMandate} disabled={!valid || !dirty || saving || Boolean(storageError)}>{saving ? "Saving…" : !dirty ? "Saved" : <>Save updated limits <ArrowRight size={17} /></>}</button></div></div>
            </section>
            <aside className="ws-policy-preview"><div className="ws-policy-preview-head"><ShieldCheck size={18} /><span>AS YOU EDIT</span></div><h2>What your limits say.</h2><p className="ws-policy-sentence">{allowedSymbols.length ? <>Only <strong>{allowedSymbols.slice(0, 3).join(", ")}{allowedSymbols.length > 3 ? ` +${allowedSymbols.length - 3}` : ""}</strong> {allowedSymbols.length===1?'is':'are'} approved.</> : <><strong>No stock purchases</strong> are approved.</>} One buy stays under <strong>{Number.isFinite(orderCents) ? usd(orderCents) : "—"}</strong>, with no more than <strong>{Number.isFinite(dailyCents) ? usd(dailyCents) : "—"}</strong> spent in a day, in Practice and with real money.</p><div className="ws-preview-meter"><div><span>Max in one stock</span><strong>{Number.isFinite(positionBps) ? `${(positionBps / 100).toFixed(1)}%` : "—"}</strong></div><div className="ws-meter-track"><span style={{ transform: `scaleX(${valid ? Math.min(100, Number(maxPosition)) / 100 : 0})` }} /></div><small>0 to 100% of total account value</small></div><div className="ws-approval"><span><Check size={16} /></span><div><strong>{executionPreference === "approval" ? "Approval before each order" : "Check only"}</strong><p>{executionPreference === "approval" ? "Steward checks the order, then you decide." : "No order is placed."}</p></div></div><p className="ws-preview-disclaimer"><LockKeyhole size={14} /> Saving these limits does not buy anything.</p></aside>
          </div>
          {saveError && <p className="ws-error" role="alert">{saveError}</p>}
          <div className="ws-below-note"><LockKeyhole size={16} /> Saving limits does not connect your wallet or place an order.</div>
        </div>}

        {view === "trail" && <div className="ws-view" data-animate={animateView} key="trail"><div className="ws-page-head"><div><span className="ws-eyebrow">DECISION TRAIL</span><h1>See the reason.<br/><em>See the result.</em></h1><p>Trail currently shows Practice decisions only. See why Steward bought, sold or held using simulated funds.</p></div><OverviewMotion variant="trail" caption="PRACTICE RECEIPTS"/></div><PracticeTrail mandateVersion={mandate.version} onLimits={()=>navigate('mandate')} onStrategy={()=>navigate('strategy')} onPractice={()=>navigate("practice")}/></div>}
      </main>
      <nav className="ws-v2-mobile-nav" aria-label="Mobile workspace navigation">
        <button type="button" aria-current={view==='overview'?'page':undefined} onClick={event=>navigate('overview',event)}><CircleDot size={20}/><span>Home</span></button>
        <RouteLink href="/chart"><ArrowUpRight size={20}/><span>Markets</span></RouteLink>
        <button type="button" aria-current={view==='alerts'?'page':undefined} onClick={event=>navigate('alerts',event)}><BellRing size={20}/><span>Alerts</span>{unreadAlerts!==null&&unreadAlerts>0&&<b className="ws-unread-badge" aria-label={`${unreadAlerts} unread alerts`}>{unreadAlerts>99?'99+':unreadAlerts}</b>}</button>
        <button type="button" aria-current={view==='practice'?'page':undefined} onClick={event=>navigate('practice',event)}><Play size={20}/><span>Practice</span></button>
        <details className="ws-v2-nav-more"><summary><SlidersHorizontal size={20}/><span>More</span></summary><div><button type="button" onClick={event=>navigate('goal',event)}>My plan</button><button type="button" onClick={event=>navigate('mandate',event)}>Limits</button><button type="button" onClick={event=>navigate('strategy',event)}>Strategy</button><button type="button" onClick={event=>navigate('trail',event)}>Trail</button><RouteLink href="/guide">Guide</RouteLink></div></details>
      </nav>
    </div>
  </div>;
}
