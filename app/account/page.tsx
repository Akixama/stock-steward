import { env } from "cloudflare:workers";
import { RouteLink } from "@/components/route-transition";
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { requireChatGPTUser, chatGPTSignOutPath } from "@/app/chatgpt-auth";
import { BrandMark, BrandName } from "@/components/brand";
import "./account.css";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireChatGPTUser("/account");
  const isDemo = user.email.endsWith("@demo.local");
  let deletionRequest: { requested_at: string; state: string } | null = null;
  if (env.DB) {
    try {
      deletionRequest = await env.DB.prepare("SELECT requested_at, state FROM data_deletion_requests WHERE owner_ref = ?")
        .bind(user.userId).first<{ requested_at: string; state: string }>();
    } catch { /* The account page remains available during a database migration. */ }
  }
  const deletionEmail = `mailto:stocksteward.support@gmail.com?subject=${encodeURIComponent("Stock Steward data deletion request")}&body=${encodeURIComponent(`Please delete my Stock Steward workspace data.\n\nMy support ID: ${user.userId}\n\n${isDemo?'I am using a temporary practice workspace.':'I am sending this from my Stock Steward sign-in email.'}`)}`;
  return <div className="account-page"><div className="account-shell">
    <header className="account-header"><RouteLink href="/" className="account-brand"><BrandMark /><BrandName /></RouteLink><RouteLink href="/workspace" className="account-back"><ArrowLeft size={15} /> Workspace</RouteLink></header>
    <main className="account-main"><div className="account-intro"><span>YOUR STOCK STEWARD ACCOUNT</span><h1>One identity.<br /><em>Your own trail.</em></h1><p>Your saved limits, practice sessions and wallet observations belong to this sign-in. Wallet spending permission is a separate choice.</p></div>
      <section className="account-panel"><div className="account-panel-head"><ShieldCheck size={18} /><span>SIGNED IN</span></div><div className="account-panel-body"><span className="account-label">{isDemo?'PRACTICE WORKSPACE':'ACCOUNT EMAIL'}</span><strong>{isDemo?user.displayName:user.email}</strong><p>{isDemo?'This demo uses a temporary browser session. Keep this browser session to return to your saved practice records; no email address was collected.':'Stock Steward uses your site-specific sign-in identity to keep mandates and receipts in your workspace.'}</p><DataRequestSection userId={user.userId} deletionRequest={deletionRequest} deletionEmail={deletionEmail} /></div><div className="account-panel-foot"><RouteLink href="/workspace">Open workspace <ArrowRight size={15} /></RouteLink><a href={chatGPTSignOutPath("/")} className="account-signout">Sign out</a></div></section>
    </main><footer className="account-footer"><span><LockKeyhole size={14} /> Your wallet keys stay with you.</span><div><RouteLink href="/privacy">Privacy</RouteLink><RouteLink href="/terms">Terms</RouteLink></div></footer>
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
