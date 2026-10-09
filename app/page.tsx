"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, CirclePause, CirclePlay, Eye, FileText, Link2, LockKeyhole, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { BrandMark, BrandName } from "@/components/brand";
import { RouteLink } from "@/components/route-transition";

const DURATION = 10_000;
const stages = [
  { label: "Observe", title: "A buy is considered.", detail: "Steward reads your wallet at one block before considering a $40 AAPL buy." },
  { label: "Check", title: "Your limit is tested.", detail: "The buy would raise AAPL exposure from 19% to 23%. Your limit is 20%." },
  { label: "Hold", title: "No order is sent.", detail: "Steward holds the proposal. Your money stays where it is." },
  { label: "Explain", title: "The reason stays visible.", detail: "The receipt records the observed figures, rule version, failed limit, and the action taken." },
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
    <div className="lp-demo-top"><div><span className="lp-kicker">THE 10-SECOND WALKTHROUGH</span><h2>See a decision<br /><em>leave a trail.</em></h2></div><div className="lp-demo-meta"><span className="lp-demo-badge">Illustrative sequence</span><span>No wallet connected · no real order</span></div></div>
    <div className="lp-demo-screen">
      <div className="lp-demo-aside"><div className="lp-demo-aside-head"><BrandMark className="brand-symbol-small" /><BrandName /><span>REVIEW</span></div><div className="lp-demo-checks"><div className={stageIndex >= 0 ? "active" : ""}><Eye size={16} /><span>Wallet snapshot</span><Check size={15} /></div><div className={stageIndex >= 1 ? "active" : ""}><ShieldCheck size={16} /><span>Mandate v3</span>{stageIndex >= 1 && <Check size={15} />}</div><div className={stageIndex >= 2 ? "active" : ""}><LockKeyhole size={16} /><span>Order status</span>{stageIndex >= 2 && <strong>HELD</strong>}</div><div className={stageIndex >= 3 ? "active" : ""}><FileText size={16} /><span>Decision receipt</span>{stageIndex >= 3 && <Check size={15} />}</div></div><div className="lp-demo-aside-foot">A saved reason for every action or hold.</div></div>
      <div className={`lp-demo-main${exiting ? " is-exiting" : ""}`} key={stageIndex}><span className="lp-stage-index">0{stageIndex + 1} / 04 — {stage.label.toUpperCase()}</span><div className="lp-live-mark"><i /> {stageIndex < 3 ? "Checking" : "Recorded"}</div><h3>{stage.title}</h3><p>{stage.detail}</p><div className="lp-evidence"><div><span>PROPOSED BUY</span><strong>$40 · AAPL</strong></div><div><span>PROJECTED EXPOSURE</span><strong className={stageIndex >= 1 ? "lp-warn" : ""}>{stageIndex >= 1 ? "23%" : "Checking…"}</strong></div><div><span>YOUR MAXIMUM</span><strong>20%</strong></div></div>{stageIndex >= 2 && <div className="lp-demo-verdict"><LockKeyhole size={16} /> Held by your concentration limit. No order submitted.</div>}</div>
    </div>
    <div className="lp-demo-controls"><div className="lp-progress" role="progressbar" aria-label="Walkthrough progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div><div className="lp-control-row"><div className="lp-stage-pips">{stages.map((item, index) => <button type="button" key={item.label} className={index === stageIndex ? "active" : ""} onClick={() => { elapsedRef.current = index * 2_500; startRef.current = performance.now() - elapsedRef.current; setElapsed(elapsedRef.current); }} aria-label={`Show ${item.label.toLowerCase()} stage`}>{item.label}</button>)}</div><button type="button" className="lp-play" onClick={toggle} aria-label={buttonLabel}>{playing ? <CirclePause size={18} /> : <CirclePlay size={18} />}<span>{buttonLabel}</span></button></div></div>
  </div>;
}

export default function Landing() {
  return <div className="lp"><header className="lp-header"><RouteLink className="lp-brand" href="/" aria-label="Stock Steward home"><BrandMark /><BrandName /></RouteLink><nav aria-label="Primary"><a href="#walkthrough">Walkthrough</a><RouteLink href="/guide">How it works</RouteLink><a href="/account">Account</a><RouteLink className="lp-nav-cta" href="/workspace">Open workspace <ArrowUpRight size={15} /></RouteLink></nav></header>
    <main><section className="lp-hero"><div className="lp-hero-glow" aria-hidden="true" /><div className="lp-eyebrow"><span className="lp-eyebrow-line" /> AN ACCOUNTABLE WAY TO INVEST</div><h1>Every dollar<br />deserves <em>a reason.</em></h1><p>Stock Steward is designed to watch your limits, explain every proposed move, and keep the evidence behind every decision—including the times it holds back.</p><div className="lp-hero-actions"><RouteLink className="lp-button-primary" href="/workspace">Set your mandate <ArrowRight size={17} /></RouteLink><a className="lp-button-secondary" href="#walkthrough">Watch the 10-second walkthrough <CirclePlay size={18} /></a></div><RouteLink className="lp-hero-guide" href="/guide">Read the technical guide <ArrowUpRight size={15} /></RouteLink><div className="lp-hero-note"><span /> A guarded wallet connection ships now · live onchain spending stays off in this version.</div></section>
      <section className="lp-how" aria-label="How Stock Steward works">
        <div className="lp-how-card"><span className="lp-how-step">01</span><SlidersHorizontal size={22} /><h3>Set your limits</h3><p>Choose which stocks are allowed and your maximums — one trade, one day, one position. Your rules are saved and versioned.</p></div>
        <div className="lp-how-card"><span className="lp-how-step">02</span><Link2 size={22} /><h3>Connect — with a leash</h3><p>Link your Robinhood Chain wallet. Steward reads your holdings and checks every proposed buy against your rules before anything can happen.</p></div>
        <div className="lp-how-card"><span className="lp-how-step">03</span><FileText size={22} /><h3>Every move leaves a receipt</h3><p>Buys, holds and refusals — each one recorded with the figures and the reason. Including the times Steward holds back.</p></div>
      </section>
      <section className="lp-demo-wrap"><TenSecondDemo /></section>
      <section className="lp-bottom"><div><span className="lp-kicker">READY TO START WITH YOUR RULES?</span><h2>Make every decision<br /><em>answerable.</em></h2><RouteLink className="lp-text-link" href="/guide">Read how Steward works <ArrowUpRight size={16} /></RouteLink></div><RouteLink className="lp-button-primary" href="/workspace">Open your workspace <ArrowRight size={17} /></RouteLink></section>
    </main><footer className="lp-footer"><span>© {new Date().getFullYear()} Stock Steward</span><span><RouteLink href="/privacy">Privacy</RouteLink> · <RouteLink href="/terms">Terms</RouteLink> · Review-first · Wallet keys stay yours</span></footer>
  </div>;
}
