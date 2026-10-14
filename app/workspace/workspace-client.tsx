"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ArrowRight, ArrowUpRight, Check, CircleDot, Clock3,
  FileText, LockKeyhole, RotateCcw, ShieldCheck, SlidersHorizontal, Play, BellRing,
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
import WalletOrdersPanel from "./wallet-orders-panel";
import { useWalletSession } from "./wallet-session";
import "./workspace.css";

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
export default function WorkspaceClient({initialMandate,storageError}:{initialMandate:Mandate|null;storageError:string|null}) {
  const walletSession = useWalletSession();
  const mainRef=useRef<HTMLElement|null>(null),navRef=useRef<HTMLElement|null>(null),motion=useRef<Animation|null>(null),navigation=useRef(0);
  const [indicator,setIndicator]=useState({left:5,width:0});
  const [view, setView] = useState<View>("overview");
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
  const invalidSymbols = allowedSymbols.filter((symbol) => !/^[A-Z.]{1,8}$/.test(symbol));
  const orderCents = Math.round(Number(maxOrder) * 100);
  const dailyCents = Math.round(Number(maxDaily) * 100);
  const positionBps = Math.round(Number(maxPosition) * 100);
  const valid = allowedSymbols.length <= 32 && allowedSymbols.every((symbol) => /^[A-Z.]{1,8}$/.test(symbol)) &&
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

  function scrollToId(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth', block: "start" });
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

  const limitsReady = Boolean(mandate.version) && !overviewState.limitIssue;
  const completedSteps = [limitsReady, overviewState.ownership, overviewState.permission, overviewState.funded, overviewState.bought, overviewState.receiptVerified].filter(Boolean).length;

  return <div className="ws">
    <header className="ws-header">
      <RouteLink href="/" className="ws-brand" aria-label="Stock Steward home"><BrandMark /><BrandName /></RouteLink>
      <div className="ws-header-actions">
        <span className="ws-header-caption">PRIVATE WORKSPACE</span>
        <RouteLink href="/guide" className="ws-guide-link">Guide <ArrowUpRight size={15} /></RouteLink>
      </div>
    </header>

    <div className="ws-shell">
      <div className="ws-toolbar">
        <div className="ws-toolbar-title"><span className="ws-toolbar-orb" aria-hidden="true" /><span>Steward / Workspace</span></div>
        <nav ref={navRef} className="ws-nav" aria-label="Workspace views"><span className="ws-nav-indicator" aria-hidden="true" style={{opacity:indicator.width?1:0,width:indicator.width,transform:"translateX("+indicator.left+"px)"}}/>
          <button type="button" className={view === "overview" ? "selected" : ""} aria-current={view === "overview" ? "page" : undefined} onClick={(event) => navigate("overview", event)}><CircleDot size={16} />Overview</button>
          <button type="button" className={view === "goal" ? "selected" : ""} aria-current={view === "goal" ? "page" : undefined} onClick={event=>navigate('goal',event)}><CircleDot size={16}/>My plan</button>
          <button type="button" className={view === "mandate" ? "selected" : ""} aria-current={view === "mandate" ? "page" : undefined} onClick={(event) => navigate("mandate", event)}><SlidersHorizontal size={16} />Mandate<span>{mandate.version ? `v${mandate.version}` : "draft"}</span></button>
          <button type="button" className={view === "alerts" ? "selected" : ""} aria-current={view === "alerts" ? "page" : undefined} onClick={event=>navigate('alerts',event)}><BellRing size={16}/>Alerts</button>
          <button type="button" className={view === "strategy" ? "selected" : ""} aria-current={view === "strategy" ? "page" : undefined} onClick={event=>navigate('strategy',event)}><ShieldCheck size={16}/>Strategy</button>
          <button type="button" className={view === "practice" ? "selected" : ""} aria-current={view === "practice" ? "page" : undefined} onClick={event=>navigate('practice',event)}><Play size={16}/>Practice</button>
          <button type="button" className={view === "trail" ? "selected" : ""} aria-label="Decision trail" aria-current={view === "trail" ? "page" : undefined} onClick={(event) => navigate("trail", event)}><Clock3 size={16} />Trail</button>
        </nav>
      </div>

      <main ref={mainRef} className="ws-main">
        {storageError && <p className="ws-error" role="alert">{storageError}</p>}
        <div hidden={view!=='strategy'&&view!=='practice'} className="ws-view" data-animate={(view==='strategy'||view==='practice')&&animateView}><StrategyPanel mandate={mandate} surface={view==='practice'?'practice':'strategy'} onSetBoundaries={()=>navigate('mandate')} onOverview={()=>navigate('overview')} onStrategy={()=>navigate('strategy')} onPractice={()=>navigate('practice')} onTrail={()=>navigate('trail')}/></div>
        {view === 'goal' && <GoalPanel mandateVersion={mandate.version} onLimits={()=>navigate('mandate')} onPractice={()=>navigate('practice')}/>}
        {view === 'alerts' && <div className="ws-view" data-animate={animateView} key="alerts"><div className="ws-page-head"><div><span className="ws-eyebrow">PRICE ALERTS</span><h1>Watch prices.<br/><em>Stay informed.</em></h1><p>Alerts are checked when you press Check prices now. They are not checked in the background and never place orders.</p></div></div><AlertsPanel mandate={mandate}/></div>}
        {view === "overview" && <div className="ws-view" data-animate={animateView} key="overview">
          <div className="ws-page-head ws-overview-heading"><div><span className="ws-eyebrow">YOUR WORKSPACE</span><h1>Stay in control.<br/><em>Approve every move.</em></h1><p>Your limits, wallet and purchases in one place.</p></div><span className="ws-overview-mode"><LockKeyhole size={14}/> Wallet approval required</span></div>
          <nav className="ws-path" aria-label="What to do next"><div className="ws-path-head"><div><span className="ws-label">DO NEXT</span><p>From saved limits to a verified purchase.</p></div><span className="ws-path-count">{completedSteps} of 6 complete</span></div><ol>
            <li><button type="button" data-state={limitsReady?'done':'current'} aria-current={!limitsReady?'step':undefined} onClick={()=>navigate('mandate')}><span className="ws-path-meta"><span className="ws-path-number">{limitsReady?<Check size={15}/>:1}</span><span className="ws-path-state">{limitsReady?'Done':overviewState.limitIssue?'Update':'Now'}</span></span><strong>Set your limits</strong><small>{overviewState.limitIssue==='expired'?'Save a new mandate version to renew an expired permission':overviewState.limitIssue==='invalid'?'Update your mandate before real orders can continue':mandate.version?`Saved as Mandate v${mandate.version}`:'Choose stocks and spending limits'}</small></button></li>
            <li><button type="button" data-state={overviewState.ownership?'done':limitsReady?'current':'upcoming'} aria-current={limitsReady&&!overviewState.ownership?'step':undefined} onClick={()=>scrollToId('ws-wallet-setup')}><span className="ws-path-meta"><span className="ws-path-number">{overviewState.ownership?<Check size={15}/>:2}</span><span className="ws-path-state">{overviewState.ownership?'Done':limitsReady?'Now':'Later'}</span></span><strong>Verify your wallet</strong><small>{overviewState.ownership?'Wallet ownership verified':'Connect on Robinhood Chain and sign a free message'}</small></button></li>
            <li><button type="button" data-state={overviewState.permission?'done':overviewState.ownership&&limitsReady?'current':'upcoming'} aria-current={overviewState.ownership&&limitsReady&&!overviewState.permission?'step':undefined} onClick={()=>scrollToId('ws-activation')}><span className="ws-path-meta"><span className="ws-path-number">{overviewState.permission?<Check size={15}/>:3}</span><span className="ws-path-state">{overviewState.permission?'Done':overviewState.ownership&&limitsReady?'Now':'Later'}</span></span><strong>Activate permission</strong><small>{overviewState.permission?'Permission active':'Approve your limits once in your wallet'}</small></button></li>
            <li><button type="button" data-state={overviewState.funded?'done':overviewState.permission?'current':'upcoming'} aria-current={overviewState.permission&&!overviewState.funded?'step':undefined} onClick={()=>scrollToId('ws-real-orders')}><span className="ws-path-meta"><span className="ws-path-number">{overviewState.funded?<Check size={15}/>:4}</span><span className="ws-path-state">{overviewState.funded?'Done':overviewState.permission?'Now':'Later'}</span></span><strong>Add USDG</strong><small>{overviewState.funded?'Enough USDG for one order':'Fund the Steward wallet for a purchase'}</small></button></li>
            <li><button type="button" data-state={overviewState.bought?'done':overviewState.funded?'current':'upcoming'} aria-current={overviewState.funded&&!overviewState.bought?'step':undefined} onClick={()=>scrollToId('ws-real-orders')}><span className="ws-path-meta"><span className="ws-path-number">{overviewState.bought?<Check size={15}/>:5}</span><span className="ws-path-state">{overviewState.bought?'Done':overviewState.funded?'Now':'Later'}</span></span><strong>Approve a buy</strong><small>{overviewState.bought?'Transaction sent':'Review the exact order in your wallet'}</small></button></li>
            <li><button type="button" data-state={overviewState.receiptVerified?'done':overviewState.bought?'current':'upcoming'} aria-current={overviewState.bought&&!overviewState.receiptVerified?'step':undefined} onClick={()=>scrollToId('ws-real-orders')}><span className="ws-path-meta"><span className="ws-path-number">{overviewState.receiptVerified?<Check size={15}/>:6}</span><span className="ws-path-state">{overviewState.receiptVerified?'Done':overviewState.bought?'Now':'Later'}</span></span><strong>Verify the result</strong><small>{overviewState.receiptVerified?'Purchase receipt verified':'Check the onchain receipt before another buy'}</small></button></li>
          </ol></nav>
          <button type="button" className="ws-practice-callout" onClick={()=>navigate('practice')}><Play size={18}/><span><strong>Try it with fake funds first</strong><small>Practice uses simulated cash and needs no wallet signature.</small></span><ArrowRight size={17}/></button>
          <div className="ws-status-strip" role="status">
            <div><span className="ws-label">MANDATE</span><strong>{mandate.version ? `v${mandate.version} saved · ${mandate.allowedSymbols.join(", ") || "no symbols"}` : "Not saved yet"}</strong></div>
            <div><span className="ws-label">MODE</span><strong>{(mandate.executionPreference ?? "approval") === "automatic" ? "Check only · no orders" : "Ask me every time"}</strong></div>
            <div><span className="ws-label">NEXT STEP</span><strong>{!mandate.version ? "Save your limits in Mandate" : "Review permission and order status below"}</strong></div>
          </div>
          <div className="ws-overview-grid ws-wallet-overview">
            <section className="ws-mandate-preview">
              <div className="ws-panel-top"><span className="ws-label">YOUR LIMITS</span><span className="ws-panel-index">MANDATE {mandate.version?`V${mandate.version}`:'DRAFT'}</span></div>
              <div className="ws-preview-body"><h2>{mandate.version ? "Your saved limits" : "Set your first limits"}</h2><p>{mandate.version ? `${mandate.allowedSymbols.length} approved ${mandate.allowedSymbols.length===1?'stock':'stocks'}. Permission status is checked below.` : "Choose stocks and purchase limits before activating permission."}</p><div className="ws-preview-rules"><div className="ws-preview-rule"><span>Per purchase</span><strong>{mandate.version ? usd(mandate.maxOrderCents) : "—"}</strong></div><div className="ws-preview-rule"><span>Per day</span><strong>{mandate.version ? usd(mandate.maxDailyBuyCents) : "—"}</strong></div><div className="ws-preview-rule"><span>2-day permission total</span><strong>{mandate.version ? usd(mandate.maxDailyBuyCents*2) : "—"}</strong><small>Calculated from two days of your daily limit.</small></div><div className="ws-preview-rule"><span>One-stock exposure</span><strong>{mandate.version ? `${mandate.maxPositionBps / 100}%` : "—"}</strong></div></div></div>
              <button type="button" className="ws-text-action" onClick={() => navigate("mandate")}>{mandate.version ? "Review your limits" : "Set your limits"}<ArrowUpRight size={17} /></button>
            </section>
          </div>
          <button type="button" className="ws-overview-trail" onClick={() => navigate("trail")}><div className="ws-trail-monogram"><FileText size={19}/></div><div><span className="ws-label">PRACTICE DECISION TRAIL</span><strong>See what Steward did.</strong><p>Review saved simulated purchases, holds and their reasons.</p></div></button>
          <WalletOrdersPanel mandate={mandate} onOpenMandate={() => navigate("mandate")} />
          <details className="ws-overview-more"><summary>Balances, funding and watch-only tools</summary><ChainPanel mandate={mandate} /></details>
        </div>}

        {view === "mandate" && <div className="ws-view" data-animate={animateView} key="mandate">
          <div className="ws-page-head"><div><span className="ws-eyebrow">YOUR MANDATE</span><h1>Decide the limits.<br /><em>Keep the control.</em></h1><p>Make the rules specific. Saving them does not grant wallet access or authorize a trade.</p></div><OverviewMotion variant="mandate" caption={mandate.version ? `MANDATE V${mandate.version}` : "UNSAVED DRAFT"}/></div>
          {legacyDraft && <p className="ws-import-note">Earlier device-only limits were found. Review these fields, then save to move them into your signed-in workspace.</p>}
          <div className="ws-mandate-grid">
            <section className="ws-editor">
              <div className="ws-editor-intro"><span className="ws-label">PURCHASE LIMITS</span><h2>Make room for restraint.</h2></div>
              <div className="ws-fields">
                <label className="ws-field ws-field-wide"><span>Approved stock symbols</span><input value={symbols} onChange={(event) => setSymbols(event.target.value)} placeholder="AAPL, MSFT, NVDA" aria-label="Approved stock symbols" /><small>Separate supported stock-token tickers with commas. Final token support is checked before activation.</small>{allowedSymbols.length>0&&<span className="ws-symbol-chips">{allowedSymbols.map(symbol=><i key={symbol} data-invalid={invalidSymbols.includes(symbol)}>{symbol}</i>)}</span>}{invalidSymbols.length>0&&<small className="ws-field-warning">Use 1 to 8 letters or periods for each ticker.</small>}</label>
                <label className="ws-field"><span>Maximum single trade</span><div className="ws-input-unit"><b>$</b><input type="number" min="0.01" step="0.01" value={maxOrder} onChange={(event) => setMaxOrder(event.target.value)} /></div></label>
                <label className="ws-field"><span>Maximum spend per day</span><div className="ws-input-unit"><b>$</b><input type="number" min="0.01" step="0.01" value={maxDaily} onChange={(event) => setMaxDaily(event.target.value)} /></div><small>The permission total is two days of this limit: {Number.isFinite(dailyCents)?usd(dailyCents*2):'—'}.</small></label>
                <label className="ws-field ws-field-wide"><span>Maximum one-stock exposure</span><div className="ws-input-unit"><input type="number" min="0" max="100" step="0.1" value={maxPosition} onChange={(event) => setMaxPosition(event.target.value)} /><b>%</b></div><small>0 to 100% of the account value.</small></label>
                <fieldset className="ws-execution-field"><legend>Action preference</legend><div className="ws-execution-options"><label className={executionPreference === "approval" ? "selected" : ""}><input type="radio" name="execution-preference" value="approval" checked={executionPreference === "approval"} onChange={() => setExecutionPreference("approval")} /><span><strong>Ask me every time</strong><small>Steward checks each buy against your limits, then you approve the exact order.</small></span></label><label className={executionPreference === "automatic" ? "selected" : ""}><input type="radio" name="execution-preference" value="automatic" checked={executionPreference === "automatic"} onChange={() => setExecutionPreference("automatic")} /><span><strong>Check only (no orders)</strong><small>Steward checks buys against your limits and shows the result. It never places orders.</small></span></label></div><p>Real purchases need the permission you activate on the Overview page.</p></fieldset>
              </div>
              <div className="ws-editor-footer"><div><span className={dirty ? "ws-dirty-dot" : "ws-clean-dot"} />{dirty ? "Unsaved changes" : `Saved as version ${mandate.version}`}</div><div className="ws-editor-actions">{dirty && mandate.version > 0 && <button type="button" className="ws-reset" onClick={resetDraft}><RotateCcw size={15} />Reset draft</button>}<button type="button" className={saved && !dirty ? "ws-save is-saved" : "ws-save"} onClick={saveMandate} disabled={!valid || !dirty || saving || Boolean(storageError)}>{saving ? "Saving…" : !dirty ? `No changes to save` : <>Save as version {mandate.version+1} <ArrowRight size={17} /></>}</button></div></div>
            </section>
            <aside className="ws-policy-preview"><div className="ws-policy-preview-head"><ShieldCheck size={18} /><span>LIVE PREVIEW / DRAFT</span></div><h2>What your limits say.</h2><p className="ws-policy-sentence">{allowedSymbols.length ? <>Only <strong>{allowedSymbols.slice(0, 3).join(", ")}{allowedSymbols.length > 3 ? ` +${allowedSymbols.length - 3}` : ""}</strong> {allowedSymbols.length===1?'is':'are'} approved.</> : <><strong>No stock purchases</strong> are approved.</>} A single trade stays under <strong>{Number.isFinite(orderCents) ? usd(orderCents) : "—"}</strong>, with no more than <strong>{Number.isFinite(dailyCents) ? usd(dailyCents) : "—"}</strong> bought in a day, in Practice and in real orders alike.</p><div className="ws-preview-meter"><div><span>One-stock ceiling</span><strong>{Number.isFinite(positionBps) ? `${(positionBps / 100).toFixed(1)}%` : "—"}</strong></div><div className="ws-meter-track"><span style={{ transform: `scaleX(${valid ? Math.min(100, Number(maxPosition)) / 100 : 0})` }} /></div><small>0 to 100% of total account value</small></div><div className="ws-approval"><span><Check size={16} /></span><div><strong>{executionPreference === "approval" ? "Approval before each order" : "Check only"}</strong><p>{executionPreference === "approval" ? "Steward checks the order, then you decide." : "No order is placed."}</p></div></div><p className="ws-preview-disclaimer"><LockKeyhole size={14} /> Preview of your limits, not a market decision.</p></aside>
          </div>
          {saveError && <p className="ws-error" role="alert">{saveError}</p>}
          <div className="ws-below-note"><LockKeyhole size={16} /> A saved mandate does not grant wallet access or place an order.</div>
        </div>}

        {view === "trail" && <div className="ws-view" data-animate={animateView} key="trail"><div className="ws-page-head"><div><span className="ws-eyebrow">DECISION TRAIL</span><h1>See the reason.<br/><em>See the result.</em></h1><p>Trail currently shows Practice decisions only. See why Steward bought, sold or held using simulated funds.</p></div><OverviewMotion variant="trail" caption="PRACTICE RECEIPTS"/></div><PracticeTrail mandateVersion={mandate.version} onLimits={()=>navigate('mandate')} onStrategy={()=>navigate('strategy')} onPractice={()=>navigate("practice")}/></div>}
      </main>
    </div>
  </div>;
}
