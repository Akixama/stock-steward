"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ArrowRight, ArrowUpRight, Check, ChevronRight, CircleDot, Clock3,
  FileText, LockKeyhole, RotateCcw, ShieldCheck, SlidersHorizontal, Play,
} from "lucide-react";
import { BrandMark, BrandName } from "@/components/brand";
import {flushSync} from 'react-dom';
import { RouteLink } from "@/components/route-transition";
import type { Mandate } from "@/lib/decision";
import OverviewMotion from './overview-motion';
import PracticeTrail from './practice-trail';
import ChainPanel from "./chain-panel";
import StrategyPanel from './strategy-panel';
import AutonomyPanel from "./autonomy-panel";
import "./workspace.css";

type View = "overview" | "mandate" | "trail" | "strategy" | "practice";
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
    const order=['overview','mandate','strategy','practice','trail'];
    const direction=order.indexOf(next)>order.indexOf(view)?1:-1;
    setAnimateView(enabled);flushSync(()=>setView(next));window.scrollTo(0,0);
    const panel=mainRef.current;
    if(enabled&&panel)motion.current=panel.animate([{opacity:.8,transform:'translateX('+(direction*8)+'px)'},{opacity:1,transform:'translateX(0)'}],{duration:180,easing:'cubic-bezier(.23,1,.32,1)'});
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
          <button type="button" className={view === "mandate" ? "selected" : ""} aria-current={view === "mandate" ? "page" : undefined} onClick={(event) => navigate("mandate", event)}><SlidersHorizontal size={16} />Mandate<span>{mandate.version ? `v${mandate.version}` : "draft"}</span></button>
          <button type="button" className={view === "strategy" ? "selected" : ""} aria-current={view === "strategy" ? "page" : undefined} onClick={event=>navigate('strategy',event)}><ShieldCheck size={16}/>Strategy</button>
          <button type="button" className={view === "practice" ? "selected" : ""} aria-current={view === "practice" ? "page" : undefined} onClick={event=>navigate('practice',event)}><Play size={16}/>Practice</button>
          <button type="button" className={view === "trail" ? "selected" : ""} aria-label="Decision trail" aria-current={view === "trail" ? "page" : undefined} onClick={(event) => navigate("trail", event)}><Clock3 size={16} />Trail</button>
        </nav>
      </div>

      <main ref={mainRef} className="ws-main">
        {storageError && <p className="ws-error" role="alert">{storageError}</p>}
        <div hidden={view!=='strategy'&&view!=='practice'} className="ws-view" data-animate={(view==='strategy'||view==='practice')&&animateView}><StrategyPanel mandate={mandate} surface={view==='practice'?'practice':'strategy'} onSetBoundaries={()=>navigate('mandate')} onStrategy={()=>navigate('strategy')} onPractice={()=>navigate('practice')} onTrail={()=>navigate('trail')}/></div>
        {view === "overview" && <div className="ws-view" data-animate={animateView} key="overview">
          <section className="ws-start-path" aria-labelledby="workspace-start-title"><div><span className="ws-label">NEW HERE?</span><h2 id="workspace-start-title">Start with a plan. Try it with fake money.</h2><p>No wallet connection or real funds needed for Practice.</p></div><div className="ws-start-steps"><button onClick={()=>navigate('mandate')}><span>1</span><strong>Set limits</strong><small>Approved stocks and budgets</small></button><button onClick={()=>navigate('strategy')}><span>2</span><strong>Create strategy</strong><small>Tell AI your direction, then confirm</small></button><button onClick={()=>navigate('practice')}><span>3</span><strong>Try Practice</strong><small>Run, approve and skip the wait</small></button><button onClick={()=>navigate('trail')}><span>4</span><strong>Review Trail</strong><small>See every purchase and reason</small></button></div></section><div className="ws-page-head"><div><span className="ws-eyebrow">01 / THE CURRENT STATE</span><h1>Your money deserves<br /><em>an explanation.</em></h1><p>Your limits are yours to set. The connection and decision trail stay honest about what has actually happened.</p></div><OverviewMotion/></div>
          <ChainPanel mandate={mandate} />
          <AutonomyPanel mandate={mandate} />
          <div className="ws-overview-grid ws-wallet-overview">
            <section className="ws-mandate-preview">
              <div className="ws-panel-top"><span className="ws-label">YOUR BOUNDARIES</span><span className="ws-panel-index">SAVED LIMITS</span></div>
              <div className="ws-preview-body"><span className="ws-preview-version">{mandate.version ? `MANDATE VERSION ${mandate.version}` : "NO MANDATE SAVED"}</span><h2>{mandate.version ? "Rules in place." : "Begin with a boundary."}</h2><p>{mandate.version ? `${mandate.allowedSymbols.length} approved stocks. Your limits are saved in this signed-in workspace.` : "Define which stocks and purchase limits the agent may use."}</p><div className="ws-preview-rules"><div className="ws-preview-rule"><span>Single buy limit</span><strong>{mandate.version ? usd(mandate.maxOrderCents) : "—"}</strong></div><div className="ws-preview-rule"><span>Daily buy limit</span><strong>{mandate.version ? usd(mandate.maxDailyBuyCents) : "—"}</strong></div><div className="ws-preview-rule"><span>Position ceiling</span><strong>{mandate.version ? `${mandate.maxPositionBps / 100}%` : "—"}</strong></div></div></div>
              <button type="button" className="ws-text-action" onClick={() => navigate("mandate")}>{mandate.version ? "Review your mandate" : "Set your boundaries"}<ArrowUpRight size={17} /></button>
            </section>
          </div>
          <button type="button" className="ws-overview-trail" onClick={() => navigate("trail")}><div className="ws-trail-monogram"><FileText size={19}/></div><div><span className="ws-label">PRACTICE DECISION TRAIL</span><strong>See what the agent did.</strong><p>Review saved simulated purchases, holds and their reasons.</p></div></button>
        </div>}

        {view === "mandate" && <div className="ws-view" data-animate={animateView} key="mandate">
          <div className="ws-page-head"><div><span className="ws-eyebrow">02 / YOUR MANDATE</span><h1>Decide the limits.<br /><em>Keep the control.</em></h1><p>Make the rules specific. Saving them does not grant wallet access or authorize a trade.</p></div><OverviewMotion variant="mandate" caption={mandate.version ? `POLICY VERSION ${mandate.version}` : "UNSAVED DRAFT"}/></div>
          {legacyDraft && <p className="ws-import-note">Earlier device-only limits were found. Review these fields, then save to move them into your signed-in workspace.</p>}
          <div className="ws-mandate-grid">
            <section className="ws-editor">
              <div className="ws-editor-intro"><span className="ws-label">PURCHASE POLICY</span><h2>Make room for restraint.</h2><p>Choose how actions are handled. Saving this mandate never authorizes a trade.</p></div>
              <div className="ws-fields">
                <label className="ws-field ws-field-wide"><span>Approved stock symbols</span><input value={symbols} onChange={(event) => setSymbols(event.target.value)} placeholder="AAPL, MSFT, NVDA" aria-label="Approved stock symbols" /><small>Separate tickers with commas. Leave empty to approve no purchases.</small></label>
                <label className="ws-field"><span>Maximum single buy</span><div className="ws-input-unit"><b>$</b><input type="number" min="0.01" step="0.01" value={maxOrder} onChange={(event) => setMaxOrder(event.target.value)} /></div></label>
                <label className="ws-field"><span>Maximum buys per day</span><div className="ws-input-unit"><b>$</b><input type="number" min="0.01" step="0.01" value={maxDaily} onChange={(event) => setMaxDaily(event.target.value)} /></div></label>
                <label className="ws-field ws-field-wide"><span>Maximum one-stock exposure</span><div className="ws-input-unit"><input type="number" min="0.01" max="100" step="0.01" value={maxPosition} onChange={(event) => setMaxPosition(event.target.value)} /><b>%</b></div></label>
                <fieldset className="ws-execution-field"><legend>Action preference</legend><div className="ws-execution-options"><label className={executionPreference === "approval" ? "selected" : ""}><input type="radio" name="execution-preference" value="approval" checked={executionPreference === "approval"} onChange={() => setExecutionPreference("approval")} /><span><strong>Ask me every time</strong><small>Review and approve each exact order before submission.</small></span></label><label className={executionPreference === "automatic" ? "selected" : ""}><input type="radio" name="execution-preference" value="automatic" checked={executionPreference === "automatic"} onChange={() => setExecutionPreference("automatic")} /><span><strong>Automatic within limits</strong><small>Save this for a future release. It is inactive today.</small></span></label></div><p>Automatic action would need a supported broker, separate activation, and tested safety controls. Selecting it here never grants trading authority.</p></fieldset>
              </div>
              <div className="ws-editor-footer"><div><span className={dirty ? "ws-dirty-dot" : "ws-clean-dot"} />{dirty ? "Unsaved changes" : `Saved as version ${mandate.version}`}</div><div className="ws-editor-actions">{dirty && mandate.version > 0 && <button type="button" className="ws-reset" onClick={resetDraft}><RotateCcw size={15} />Reset draft</button>}<button type="button" className={saved && !dirty ? "ws-save is-saved" : "ws-save"} onClick={saveMandate} disabled={!valid || !dirty || saving || Boolean(storageError)}>{saving ? "Saving…" : saved && !dirty ? <><Check size={17} /> Saved</> : <>Save mandate <ArrowRight size={17} /></>}</button></div></div>
            </section>
            <aside className="ws-policy-preview"><div className="ws-policy-preview-head"><ShieldCheck size={18} /><span>LIVE PREVIEW / DRAFT</span></div><h2>What your limits say.</h2><p className="ws-policy-sentence">{allowedSymbols.length ? <>Consider <strong>{allowedSymbols.slice(0, 3).join(", ")}{allowedSymbols.length > 3 ? ` +${allowedSymbols.length - 3}` : ""}</strong> only.</> : <>Consider <strong>no stock purchases</strong>.</>} A single buy stays under <strong>{Number.isFinite(orderCents) ? usd(orderCents) : "—"}</strong>, with no more than <strong>{Number.isFinite(dailyCents) ? usd(dailyCents) : "—"}</strong> bought in a day.</p><div className="ws-preview-meter"><div><span>One-stock ceiling</span><strong>{Number.isFinite(positionBps) ? `${(positionBps / 100).toFixed(2)}%` : "—"}</strong></div><div className="ws-meter-track"><span style={{ transform: `scaleX(${valid ? Math.min(100, Number(maxPosition)) / 100 : 0})` }} /></div><small>Share of total account value</small></div><div className="ws-approval"><span><Check size={16} /></span><div><strong>{executionPreference === "approval" ? "Approval before each order" : dirty ? "Automatic preference in draft" : "Automatic preference saved"}</strong><p>{executionPreference === "approval" ? "Current execution rule. Broker access and a fresh check are also required." : "Inactive. Approval remains required in this version."}</p></div></div><p className="ws-preview-disclaimer"><LockKeyhole size={14} /> Preview of your rules, not a market decision.</p></aside>
          </div>
          {saveError && <p className="ws-error" role="alert">{saveError}</p>}
          <div className="ws-below-note"><LockKeyhole size={16} /> A saved mandate does not grant wallet access or place an order.</div>
        </div>}

        {view === "trail" && <div className="ws-view" data-animate={animateView} key="trail"><div className="ws-page-head"><div><span className="ws-eyebrow">03 / DECISION TRAIL</span><h1>See the reason.<br/><em>See the result.</em></h1><p>Saved practice decisions show the rules checked and why the agent bought or held. All purchases here use simulated funds.</p></div><OverviewMotion variant="trail" caption="PRACTICE RECEIPTS"/></div><PracticeTrail onStrategy={()=>navigate("practice")}/></div>}
      </main>
    </div>
  </div>;
}
