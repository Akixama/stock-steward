import { env } from "cloudflare:workers";
import Link from "next/link";
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { BrandMark, BrandName } from "@/components/brand";
import "./account.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireChatGPTUser("/account");
  let deletionRequest: { requested_at: string; state: string } | null = null;
  if (env.DB) {
    try {
      deletionRequest = await env.DB.prepare("SELECT requested_at, state FROM data_deletion_requests WHERE owner_ref = ?")
        .bind(user.userId).first<{ requested_at: string; state: string }>();
    } catch { /* The account page remains available during a database migration. */ }
  }
  const deletionEmail = `mailto:stocksteward.support@gmail.com?subject=${encodeURIComponent("Stock Steward data deletion request")}&body=${encodeURIComponent(`Please delete my Stock Steward workspace data.\n\nMy support ID: ${user.userId}\n\nI am sending this from my Stock Steward sign-in email.`)}`;
  return <div className="account-page"><div className="account-shell">
    <header className="account-header"><Link href="/" className="account-brand"><BrandMark /><BrandName /></Link><Link href="/workspace" className="account-back"><ArrowLeft size={15} /> Workspace</Link></header>
    <main className="account-main"><div className="account-intro"><span>YOUR STOCK STEWARD ACCOUNT</span><h1>One identity.<br /><em>Your own trail.</em></h1><p>Your saved limits, practice sessions and wallet observations belong to this sign-in. Wallet spending permission is a separate choice.</p></div>
      <section className="account-panel"><div className="account-panel-head"><ShieldCheck size={18} /><span>SIGNED IN</span></div><div className="account-panel-body"><span className="account-label">ACCOUNT EMAIL</span><strong>{user.email}</strong><p>Stock Steward uses your site-specific sign-in identity to keep mandates and receipts in your workspace.</p><DataRequestSection userId={user.userId} deletionRequest={deletionRequest} deletionEmail={deletionEmail} /></div><div className="account-panel-foot"><Link href="/workspace">Open workspace <ArrowRight size={15} /></Link><a href={chatGPTSignOutPath("/")} className="account-signout">Sign out</a></div></section>
    </main><footer className="account-footer"><span><LockKeyhole size={14} /> Your wallet keys stay with you.</span><div><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div></footer>
  </div></div>;
}

function DataRequestSection({ userId, deletionRequest, deletionEmail }: {
  userId: string;
  deletionRequest: { requested_at: string; state: string } | null;
  deletionEmail: string;
}) {
  return <><div className="account-divider" /><span className="account-label">DATA REQUESTS</span>
    {deletionRequest ? <p role="status">Your deletion request was received on {new Date(deletionRequest.requested_at).toLocaleDateString("en-US", { dateStyle: "medium" })}. Status: {deletionRequest.state}. We will review it before removing any saved record.</p> : <p>Ask us to delete your Stock Steward workspace data. This records a request under your signed-in identity; it does not erase data or authorize a wallet action.</p>}
    <code className="account-support-id">Support ID: {userId}</code>
    {!deletionRequest && <form action="/api/account/data-deletion" method="post"><button className="account-data-link" type="submit">Request data deletion <ArrowRight size={15} /></button></form>}
    <a className="account-data-link" href={deletionEmail}>Email support about this request <ArrowRight size={15} /></a>
  </>;
}
