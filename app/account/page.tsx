import { env } from "cloudflare:workers";
import Link from "next/link";
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { BrandMark, BrandName } from "@/components/brand";
import { alpacaConfigured, getAlpacaConnection } from "@/lib/alpaca-connection";
import "./account.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireChatGPTUser("/account");
  let connection: { accountRef: string; environment: string; tradingScope: boolean } | null = null;
  if (alpacaConfigured() && env.DB) {
    try {
      const saved = await getAlpacaConnection(env.DB, user.userId);
      if (saved) connection = { accountRef: saved.accountRef, environment: saved.environment, tradingScope: saved.tradingScope };
    } catch { /* An unavailable broker connection must not hide account identity. */ }
  }
  return <div className="account-page"><div className="account-shell">
    <header className="account-header"><Link href="/" className="account-brand"><BrandMark /><BrandName /></Link><Link href="/workspace" className="account-back"><ArrowLeft size={15} /> Workspace</Link></header>
    <main className="account-main"><div className="account-intro"><span>YOUR STOCK STEWARD ACCOUNT</span><h1>One identity.<br /><em>Your own trail.</em></h1><p>Your workspace records are tied to this sign-in. Alpaca access is a separate permission you choose to grant.</p></div>
      <section className="account-panel"><div className="account-panel-head"><ShieldCheck size={18} /><span>SIGNED IN</span></div><div className="account-panel-body"><span className="account-label">ACCOUNT EMAIL</span><strong>{user.email}</strong><p>Stock Steward uses your site-specific sign-in identity to keep mandates and receipts in your workspace.</p><div className="account-divider" /><span className="account-label">BROKER CONNECTION</span><strong>{connection ? `Alpaca ${connection.environment} ···${connection.accountRef.slice(-6)}` : "No broker connected"}</strong><p>{connection ? connection.tradingScope ? "Trading permission is connected. Every order still requires exact owner approval and the deployment order switch." : "Account data permission is connected. No trading permission is granted." : "A sign-in alone cannot read a brokerage account or place an order."}</p></div><div className="account-panel-foot"><Link href="/workspace">Open workspace <ArrowRight size={15} /></Link><a href={chatGPTSignOutPath("/")} className="account-signout">Sign out</a></div></section>
    </main><footer className="account-footer"><span><LockKeyhole size={14} /> Your broker password stays with Alpaca.</span><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></footer>
  </div></div>;
}
