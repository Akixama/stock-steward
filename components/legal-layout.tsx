import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { BrandMark, BrandName } from "@/components/brand";
import "@/app/legal.css";

export function LegalLayout({ eyebrow, title, updated, children }: {
  eyebrow: string; title: string; updated: string; children: React.ReactNode;
}) {
  return <div className="legal-page"><div className="legal-shell">
    <header className="legal-header"><Link href="/" className="legal-brand"><BrandMark /><BrandName /></Link><Link href="/" className="legal-back"><ArrowLeft size={15} /> Home</Link></header>
    <main className="legal-main"><aside className="legal-aside"><span className="legal-kicker">STOCK STEWARD / {eyebrow}</span><h1>{title}</h1><p>Last revised {updated}</p><div className="legal-draft">Early access · broker connection unavailable</div><nav aria-label="Legal pages"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav></aside><article className="legal-article">{children}</article></main>
    <footer className="legal-footer"><span>Stock Steward · independent brokerage interface</span><Link href="/guide">Technical guide <ArrowUpRight size={14} /></Link></footer>
  </div></div>;
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2>{title}</h2>{children}</section>;
}
