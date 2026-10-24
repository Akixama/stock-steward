"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, CirclePause, CirclePlay, Eye, FileText, Link2, LockKeyhole, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { BrandMark, BrandName } from "@/components/brand";
import { RouteLink } from "@/components/route-transition";
import { GUARDRAIL_COPY, TRADE_AGREEMENT_LABEL, TRADING_RISK_TEXT, US_RESTRICTION_TEXT } from '@/config/public-launch-copy';

const DURATION = 10_000;
const stages = [
  { label: "Watch", title: "You set your price.", detail: "In this illustrative example: buy $10 of MSFT when it drops to $530 or less. Steward checks the price every 15 minutes." },
  { label: "Check", title: "Your limits are tested.", detail: "MSFT is in your limits, and $10 fits your $10 per buy and $50 per day." },
  { label: "Ready", title: "A buy waits for you.", detail: "It shows under Ready to buy. Nothing is spent yet, and Steward never buys on its own." },
  { label: "Approve", title: "You decide in your wallet.", detail: "Review the exact order and sign it, or let it go. Every buy is saved in Activity." },
];

function TenSecondDemo() {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const elapsedRef = useRef(0);
  const startRef = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frame = requestAnimationFrame(() => setPlaying(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!playing) return;
    startRef.current = performance.now() - elapsedRef.current;
    let frame = 0;
    const tick = (now: number) => {
      const next = Math.max(0, now - startRef.current) % DURATION;
      elapsedRef.current = next;
      setElapsed(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const stageIndex = Math.max(0, Math.min(stages.length - 1, Math.floor(elapsed / 2_500)));
  const stage = stages[stageIndex];
  const progress = Math.min(100, elapsed / DURATION * 100);
  const buttonLabel = playing ? "Pause walkthrough" : "Play walkthrough";
  const exiting = playing && elapsed % 2_500 > 2_120;
  function toggle() {
    setPlaying((value) => !value);
  }

  return <div className="lp-demo" id="walkthrough" aria-label="Illustrative ten-second walkthrough">
    <div className="lp-demo-top"><div><span className="lp-kicker">THE 10-SECOND WALKTHROUGH</span><h2>See a buy<br /><em>wait for your yes.</em></h2></div><div className="lp-demo-meta"><span className="lp-demo-badge">Illustrative sequence</span><span>Example only · no real order</span></div></div>
    <div className="lp-demo-screen">
      <div className="lp-demo-aside"><div className="lp-demo-aside-head"><BrandMark className="brand-symbol-small" /><BrandName /><span>STRATEGY</span></div><div className="lp-demo-checks"><div className={stageIndex >= 0 ? "active" : ""}><Eye size={16} /><span>Price watched</span><Check size={15} /></div><div className={stageIndex >= 1 ? "active" : ""}><ShieldCheck size={16} /><span>Your limits</span>{stageIndex >= 1 && <Check size={15} />}</div><div className={stageIndex >= 2 ? "active" : ""}><LockKeyhole size={16} /><span>Ready to buy</span>{stageIndex >= 2 && <strong>WAITING</strong>}</div><div className={stageIndex >= 3 ? "active" : ""}><FileText size={16} /><span>Your wallet</span>{stageIndex >= 3 && <Check size={15} />}</div></div><div className="lp-demo-aside-foot">Nothing is bought until you approve.</div></div>
      <div className={`lp-demo-main${exiting ? " is-exiting" : ""}`} key={stageIndex}><span className="lp-stage-index">0{stageIndex + 1} / 04 — {stage.label.toUpperCase()}</span><div className="lp-live-mark"><i /> {stageIndex < 2 ? "Watching" : stageIndex === 2 ? "Waiting for you" : "Your call"}</div><h3>{stage.title}</h3><p>{stage.detail}</p><div className="lp-evidence"><div><span>YOUR PLAN</span><strong>$10 · MSFT at $530 or less</strong></div><div><span>PRICE NOW</span><strong>{stageIndex >= 1 ? "$524.17" : "Checking…"}</strong></div><div><span>YOUR LIMITS</span><strong>$10 per buy · $50 per day</strong></div></div>{stageIndex >= 2 && <div className="lp-demo-verdict"><LockKeyhole size={16} /> {stageIndex === 2 ? "Ready to buy. No order placed yet." : "Only your wallet signature can place it."}</div>}</div>
    </div>
    <div className="lp-demo-controls"><div className="lp-progress" role="progressbar" aria-label="Walkthrough progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div><div className="lp-control-row"><div className="lp-stage-pips">{stages.map((item, index) => <button type="button" key={item.label} className={index === stageIndex ? "active" : ""} onClick={() => { elapsedRef.current = index * 2_500; startRef.current = performance.now() - elapsedRef.current; setElapsed(elapsedRef.current); }} aria-label={`Show ${item.label.toLowerCase()} stage`}>{item.label}</button>)}</div><button type="button" className="lp-play" onClick={toggle} aria-label={buttonLabel}>{playing ? <CirclePause size={18} /> : <CirclePlay size={18} />}<span>{buttonLabel}</span></button></div></div>
  </div>;
}

export default function LandingClient({publicMode}:{publicMode:boolean}) {
  return <div className="lp"><header className="lp-header"><RouteLink className="lp-brand" href="/" aria-label="Stock Steward home"><BrandMark /><BrandName /></RouteLink><nav aria-label="Primary"><a href="#walkthrough">Walkthrough</a><RouteLink href="/chart">Markets</RouteLink><RouteLink href="/guide">How it works</RouteLink><a href="/account">Account</a><RouteLink className="lp-nav-cta" href="/workspace">Open workspace <ArrowUpRight size={15} /></RouteLink></nav></header>
    <main><section className="lp-hero"><div className="lp-hero-glow" aria-hidden="true" /><div className="lp-eyebrow"><span className="lp-eyebrow-line" /> YOUR WALLET. YOUR LIMITS.</div><h1>Every dollar<br />deserves <em>a reason.</em></h1><p>{GUARDRAIL_COPY}</p><div className="lp-hero-actions"><RouteLink className="lp-button-primary" href="/workspace">Open workspace <ArrowRight size={17} /></RouteLink><a className="lp-button-secondary" href="#walkthrough">See the 10-second example <CirclePlay size={18} /></a></div><div className="lp-hero-secondary"><RouteLink className="lp-hero-guide" href="/chart">Explore markets <ArrowUpRight size={15} /></RouteLink><RouteLink className="lp-hero-guide" href="/guide">See how it works <ArrowUpRight size={15} /></RouteLink></div><div className="lp-hero-note"><span /> {publicMode?'To use real money: accept the terms, connect and verify your wallet, set your limits, activate permission, then fund that wallet. Every action needs your signature.':'Real buying and selling remain a private pilot. Markets and fake-money Practice are open.'} {US_RESTRICTION_TEXT}</div></section>
      <section className="lp-how" aria-label="How Stock Steward works">
        <div className="lp-how-card"><span className="lp-how-step">01</span><SlidersHorizontal size={22} /><h3>Set your limits</h3><p>Choose which stocks are allowed and your maximums — one trade, one day, one position. You can review or change these limits later.</p></div>
        <div className="lp-how-card"><span className="lp-how-step">02</span><Link2 size={22} /><h3>Connect your wallet</h3><p>Use a wallet such as MetaMask on Robinhood Chain. Verify that you control it, turn on buying, then add USDG to your Steward wallet.</p></div>
        <div className="lp-how-card"><span className="lp-how-step">03</span><FileText size={22} /><h3>See what happened</h3><p>Review and sign each exact Buy, Sell or Send action yourself. See its saved receipt and transaction hash afterward.</p></div>
      </section>
      <section className="lp-demo-wrap"><TenSecondDemo /></section>
      <section className="lp-bottom"><div><span className="lp-kicker">READY TO START WITH YOUR RULES?</span><h2>Make every decision<br /><em>answerable.</em></h2><p>{TRADING_RISK_TEXT} Before a first real action: “{TRADE_AGREEMENT_LABEL}”</p><RouteLink className="lp-text-link" href="/guide">Read how Steward works <ArrowUpRight size={16} /></RouteLink></div><RouteLink className="lp-button-primary" href="/workspace">Open your workspace <ArrowRight size={17} /></RouteLink></section>
    </main><footer className="lp-footer"><span>© {new Date().getFullYear()} Stock Steward</span><span><RouteLink href="/privacy">Privacy</RouteLink> · <RouteLink href="/terms">Terms</RouteLink> · Review-first · Wallet keys stay yours</span></footer>
  </div>;
}
