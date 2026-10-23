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
import { editableLimitsValid, MAX_EDITABLE_LIMIT_CENTS, NEW_USER_MANDATE } from "@/lib/editable-limits";
import OverviewMotion from './overview-motion';
import AlertsPanel from './alerts-panel';
import ActivityPanel from './activity-panel';
import ChainPanel from "./chain-panel";
import StrategyPanel from './strategy-panel';
import AutomaticPanel from './automatic-panel';
import GoalPanel from './goal-panel';
import type {BuyIdea} from '@/lib/buy-idea';
import WalletOrdersPanel from "./wallet-orders-panel";
import { useWalletSession } from "./wallet-session";
import StockSelector from './stock-selector';
import "./workspace.css";
import "./workspace-redesign.css";
import "./workspace-v2.css";
import "./workspace-v3.css";
import "./workspace-v4.css";
import "./workspace-v5.css";
import "./workspace-v6.css";

type View = "overview" | "strategy" | "alerts" | "activity" | "mandate";
type StrategyMode = "real" | "practice";
// Old deep links keep working: practice opens Strategy (Practice), trail opens Activity, goal opens Strategy.
const LINKED_VIEWS: Record<string, [View, StrategyMode?]> = { overview: ["overview"], home: ["overview"], strategy: ["strategy", "real"], practice: ["strategy", "practice"], goal: ["strategy", "real"], alerts: ["alerts"], trail: ["activity"], activity: ["activity"], mandate: ["mandate"], limits: ["mandate"] };
const initial: Mandate = NEW_USER_MANDATE;
const oldDeviceStore = "stock-steward-brokerage-mandate-v1";
const usd = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(cents / 100);
export default function WorkspaceClient({initialMandate,storageError,publicMode}:{initialMandate:Mandate|null;storageError:string|null;publicMode:boolean}) {
  const walletSession = useWalletSession();
  const mainRef=useRef<HTMLElement|null>(null),navRef=useRef<HTMLElement|null>(null),motion=useRef<Animation|null>(null),navigation=useRef(0);
  const [indicator,setIndicator]=useState({left:5,width:0});
  const [view, setView] = useState<View>("overview");
  const [strategyMode, setStrategyMode] = useState<StrategyMode>("real");
  const [goalOpen, setGoalOpen] = useState(false);
  const [buyIdeaRequest,setBuyIdeaRequest]=useState<(BuyIdea&{id:number})|null>(null);
  const [unreadAlerts, setUnreadAlerts] = useState<number | null>(null);
  useEffect(()=>{const linked=LINKED_VIEWS[new URLSearchParams(window.location.search).get('view')??''];if(!linked)return;const timer=setTimeout(()=>{setView(linked[0]);if(linked[1])setStrategyMode(linked[1]);if(new URLSearchParams(window.location.search).get('view')==='goal')setGoalOpen(true);},0);return()=>clearTimeout(timer);},[]);
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
    editableLimitsValid(orderCents, dailyCents) &&
    Number(maxPosition) > 0 && Number(maxPosition) <= 100;
  const dirty = mandate.version === 0 || allowedSymbols.join(",") !== mandate.allowedSymbols.join(",") ||
    orderCents !== mandate.maxOrderCents || dailyCents !== mandate.maxDailyBuyCents ||
    positionBps !== mandate.maxPositionBps || executionPreference !== (mandate.executionPreference ?? "approval");

  function navigate(next: View, event?: MouseEvent<HTMLButtonElement>) {
    navigation.current++;motion.current?.cancel();if(next===view)return;
    const enabled=(!event||event.detail!==0)&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const order=['overview','strategy','alerts','activity','mandate'];
    const direction=order.indexOf(next)>order.indexOf(view)?1:-1;
    setAnimateView(enabled);flushSync(()=>setView(next));window.scrollTo(0,0);
    const panel=mainRef.current;
    if(enabled&&panel)motion.current=panel.animate([{opacity:.7,transform:'translateX('+(direction*12)+'px)'},{opacity:1,transform:'translateX(0)'}],{duration:200,easing:'cubic-bezier(.23,1,.32,1)'});
  }
  function openStrategy(mode:StrategyMode){setStrategyMode(mode);navigate('strategy');}
  function openBuyIdea(idea:BuyIdea){setBuyIdeaRequest({...idea,id:Date.now()});navigate('overview');}

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
      if (!response.ok || !result.mandate) throw new Error(result.error ?? "Could not save your limits.");
      setMandate(result.mandate);
      if (legacyDraft) {
        localStorage.removeItem(oldDeviceStore);
        setLegacyDraft(false);
      }
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2800);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save your limits.");
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
          <button type="button" className={view === "overview" ? "selected" : ""} aria-current={view === "overview" ? "page" : undefined} onClick={(event) => navigate("overview", event)}><CircleDot size={16} />Home</button>
          <button type="button" className={view === "strategy" ? "selected" : ""} aria-current={view === "strategy" ? "page" : undefined} onClick={event=>navigate('strategy',event)}><ShieldCheck size={16}/>Strategy</button>
          <button type="button" className={view === "alerts" ? "selected" : ""} aria-current={view === "alerts" ? "page" : undefined} onClick={event=>navigate('alerts',event)}><BellRing size={16}/>Alerts{unreadAlerts!==null&&unreadAlerts>0&&<b className="ws-unread-badge" aria-label={`${unreadAlerts} unread alerts`}>{unreadAlerts>99?'99+':unreadAlerts}</b>}</button>
          <button type="button" className={view === "activity" ? "selected" : ""} aria-current={view === "activity" ? "page" : undefined} onClick={(event) => navigate("activity", event)}><Clock3 size={16} />Activity</button>
          <button type="button" className={view === "mandate" ? "selected" : ""} aria-current={view === "mandate" ? "page" : undefined} onClick={(event) => navigate("mandate", event)}><SlidersHorizontal size={16} />Limits</button>
        </nav>
      </div>

      <main ref={mainRef} className="ws-main">
        {storageError && <p className="ws-error" role="alert">{storageError}</p>}
        {/* Practice stays mounted so a running practice session keeps checking while you switch tabs. */}
        <div hidden={view!=='strategy'} className="ws-view ws-v6-strategy" data-mode={strategyMode} data-animate={view==='strategy'&&animateView}>
          <div className="ws-strategy-switch" role="group" aria-label="Real or practice"><button type="button" aria-pressed={strategyMode==='real'} onClick={()=>setStrategyMode('real')}>Real money</button><button type="button" aria-pressed={strategyMode==='practice'} onClick={()=>setStrategyMode('practice')}>Practice</button></div>
          <div hidden={strategyMode!=='practice'} className="ws-strategy-practice"><StrategyPanel mandate={mandate} surface="practice" onSetBoundaries={()=>navigate('mandate')} onOverview={()=>navigate('overview')} onStrategy={()=>document.getElementById('ws-strategy-builder')?.scrollIntoView({behavior:'smooth',block:'start'})} onPractice={()=>window.scrollTo({top:0,behavior:'smooth'})} onTrail={()=>navigate('activity')}/></div>
          {view==='strategy'&&strategyMode==='real'&&<AutomaticPanel mandate={mandate} onReviewBuy={openBuyIdea}/>}
          {view==='strategy'&&strategyMode==='real'&&<details className="ws-strategy-goal" id="ws-goal" open={goalOpen} onToggle={e=>setGoalOpen((e.currentTarget as HTMLDetailsElement).open)}><summary>Your plan</summary>{goalOpen&&<GoalPanel mandateVersion={mandate.version} onLimits={()=>navigate('mandate')} onPractice={()=>openStrategy('practice')}/>}</details>}
        </div>
        {view === 'alerts' && <div className="ws-view ws-v6-alerts" data-animate={animateView} key="alerts"><div className="ws-page-head"><div><span className="ws-eyebrow">ALERTS</span><h1>Watch prices.<br/><em>Stay informed.</em></h1><p>Price alerts and buy ideas in one place. Alerts never place orders.</p></div></div><AlertsPanel mandate={mandate} onCount={setUnreadAlerts} onReviewBuy={openBuyIdea}/></div>}
        {view === "overview" && <div className="ws-view ws-v2-overview" data-animate={animateView} key="overview">
          <WalletOrdersPanel mandate={mandate} onOpenMandate={() => navigate("mandate")} publicMode={publicMode} buyIdeaRequest={buyIdeaRequest} onBuyIdeaOpened={()=>setBuyIdeaRequest(null)} progress={{done:completedSteps,total:3,complete:setupComplete,next:!limitsReady?'Set your buying limits':!overviewState.ownership?'Connect and verify your wallet':'Activate buying permission',action:!limitsReady?'limits':'setup'}} />
          <details className="ws-v2-more"><summary>Help</summary><ChainPanel mandate={mandate} /></details>
        </div>}
        {view === "mandate" && <div className="ws-view" data-animate={animateView} key="mandate">
          <div className="ws-page-head"><div><span className="ws-eyebrow">YOUR LIMITS</span><h1>Decide the limits.<br /><em>Keep the control.</em></h1><p>Choose which stocks you can buy and how much you can spend.</p></div><OverviewMotion variant="mandate" caption={mandate.version ? "LIMITS SAVED" : "UNSAVED DRAFT"}/></div>
          {legacyDraft && <p className="ws-import-note">Earlier device-only limits were found. Review these fields, then save to move them into your signed-in workspace.</p>}
          <div className="ws-mandate-grid">
            <section className="ws-editor">
              <div className="ws-editor-intro"><span className="ws-label">PURCHASE LIMITS</span><h2>Choose what works for you.</h2></div>
              <div className="ws-fields">
                <StockSelector selected={allowedSymbols} onChange={(next) => setSymbols(next.join(', '))} />
                <label className="ws-field"><span>Most per buy</span><div className="ws-input-unit"><b>$</b><input type="number" min="0.01" max={MAX_EDITABLE_LIMIT_CENTS/100} step="0.01" value={maxOrder} onChange={(event) => setMaxOrder(event.target.value)} /></div></label>
                <label className="ws-field"><span>Most per day</span><div className="ws-input-unit"><b>$</b><input type="number" min="0.01" max={MAX_EDITABLE_LIMIT_CENTS/100} step="0.01" value={maxDaily} onChange={(event) => setMaxDaily(event.target.value)} /></div><small>Across two days, that is {Number.isFinite(dailyCents)?usd(dailyCents*2):'—'}. New limits can be up to {usd(MAX_EDITABLE_LIMIT_CENTS)} per buy and per day.</small></label>
                {(orderCents>MAX_EDITABLE_LIMIT_CENTS||dailyCents>MAX_EDITABLE_LIMIT_CENTS)&&<p className="ws-field ws-field-wide" role="status">Your saved limits still work. To save an edit, set both amounts to {usd(MAX_EDITABLE_LIMIT_CENTS)} or less.</p>}
                <label className="ws-field ws-field-wide"><span>Most you can hold in one stock</span><div className="ws-input-unit"><input type="number" min="0" max="100" step="0.1" value={maxPosition} onChange={(event) => setMaxPosition(event.target.value)} /><b>%</b></div><small>0 to 100% of the account value.</small></label>
                <div className="ws-order-rule"><span className="ws-label">HOW ORDERS WORK</span><strong>{executionPreference === "approval" ? "You approve every real purchase" : "Buying is turned off"}</strong><p>{executionPreference === "approval" ? "Steward checks your limits first. You review and sign each exact order in your wallet. Use Practice to try decisions with simulated funds." : "This older setting blocks real buys. Switch to wallet approval and save your limits to buy."}</p>{executionPreference === "automatic" && <button type="button" onClick={() => setExecutionPreference("approval")}>Use wallet approval <ArrowRight size={16} /></button>}</div>
              </div>
              <div className="ws-editor-footer"><div className="ws-save-status"><span className={dirty ? "ws-dirty-dot" : "ws-clean-dot"} /><div><strong>{dirty ? "Unsaved changes" : mandate.version ? "Limits saved" : "No saved limits yet"}</strong><small>Changing limits creates a new Steward wallet. Funds in the old one stay there until you move them.</small></div></div><div className="ws-editor-actions">{dirty && mandate.version > 0 && <button type="button" className="ws-reset" onClick={resetDraft}><RotateCcw size={15} />Reset draft</button>}<button type="button" className={saved && !dirty ? "ws-save is-saved" : "ws-save"} onClick={saveMandate} disabled={!valid || !dirty || saving || Boolean(storageError)}>{saving ? "Saving…" : !dirty ? "Saved" : <>Save updated limits <ArrowRight size={17} /></>}</button></div></div>
            </section>
            <aside className="ws-policy-preview"><div className="ws-policy-preview-head"><ShieldCheck size={18} /><span>AS YOU EDIT</span></div><h2>What your limits say.</h2><p className="ws-policy-sentence">{allowedSymbols.length ? <>Only <strong>{allowedSymbols.slice(0, 3).join(", ")}{allowedSymbols.length > 3 ? ` +${allowedSymbols.length - 3}` : ""}</strong> {allowedSymbols.length===1?'is':'are'} approved.</> : <><strong>No stock purchases</strong> are approved.</>} One buy stays under <strong>{Number.isFinite(orderCents) ? usd(orderCents) : "—"}</strong>, with no more than <strong>{Number.isFinite(dailyCents) ? usd(dailyCents) : "—"}</strong> spent in a day, in Practice and with real money.</p><div className="ws-preview-meter"><div><span>Max in one stock</span><strong>{Number.isFinite(positionBps) ? `${(positionBps / 100).toFixed(1)}%` : "—"}</strong></div><div className="ws-meter-track"><span style={{ transform: `scaleX(${valid ? Math.min(100, Number(maxPosition)) / 100 : 0})` }} /></div><small>0 to 100% of total account value</small></div><div className="ws-approval"><span><Check size={16} /></span><div><strong>{executionPreference === "approval" ? "Approval before each order" : "Check only"}</strong><p>{executionPreference === "approval" ? "Steward checks the order, then you decide." : "No order is placed."}</p></div></div></aside>
          </div>
          {saveError && <p className="ws-error" role="alert">{saveError}</p>}
          <div className="ws-below-note"><LockKeyhole size={16} /> Saving limits does not connect your wallet or place an order.</div>
        </div>}

        {view === "activity" && <div className="ws-view ws-v6-alerts ws-v7-activity" data-animate={animateView} key="activity"><div className="ws-page-head"><div><span className="ws-eyebrow">ACTIVITY</span><h1>What happened.<br/><em>And why.</em></h1><p>Every real action needed your wallet signature.</p></div></div><ActivityPanel mandateVersion={mandate.version} onLimits={()=>navigate('mandate')} onStrategy={()=>openStrategy('practice')} onPractice={()=>openStrategy('practice')}/></div>}
      </main>
      <nav className="ws-v2-mobile-nav" aria-label="Mobile workspace navigation">
        <button type="button" aria-current={view==='overview'?'page':undefined} onClick={event=>navigate('overview',event)}><CircleDot size={20}/><span>Home</span></button>
        <button type="button" aria-current={view==='strategy'?'page':undefined} onClick={event=>navigate('strategy',event)}><ShieldCheck size={20}/><span>Strategy</span></button>
        <button type="button" aria-current={view==='alerts'?'page':undefined} onClick={event=>navigate('alerts',event)}><BellRing size={20}/><span>Alerts</span>{unreadAlerts!==null&&unreadAlerts>0&&<b className="ws-unread-badge" aria-label={`${unreadAlerts} unread alerts`}>{unreadAlerts>99?'99+':unreadAlerts}</b>}</button>
        <button type="button" aria-current={view==='activity'?'page':undefined} onClick={event=>navigate('activity',event)}><Clock3 size={20}/><span>Activity</span></button>
        <button type="button" aria-current={view==='mandate'?'page':undefined} onClick={event=>navigate('mandate',event)}><SlidersHorizontal size={20}/><span>Limits</span></button>
      </nav>
    </div>
  </div>;
}
