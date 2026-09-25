import { env } from "cloudflare:workers";
import Link from "next/link";
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { requireChatGPTUser } from "@/app/chatgpt-auth";
import { BrandMark, BrandName } from "@/components/brand";
import { alpacaConfigured, alpacaOrderSubmissionEnabled,
  getAlpacaConnection } from "@/lib/alpaca-connection";
import "./connect.css";

export const dynamic = "force-dynamic";

export default async function ConnectPage({ searchParams }: {
  searchParams: Promise<{ intent?: string }>;
}) {
  const trading = (await searchParams).intent === "trading";
  const user = await requireChatGPTUser(trading ? "/connect?intent=trading" : "/connect");
  const configured = alpacaConfigured();
  let connection: Awaited<ReturnType<typeof getAlpacaConnection>> = null;
  if (configured && env.DB) {
    try { connection = await getAlpacaConnection(env.DB, user.userId); }
    catch { /* A broken connection cannot grant trading permission. */ }
  }
  const ready = configured && (!trading || Boolean(connection &&
    alpacaOrderSubmissionEnabled(connection.environment) && !connection.tradingScope));

  return <div className="connect-page">
    <div className="connect-shell">
      <header className="connect-header"><Link href="/" className="connect-brand"><BrandMark /><BrandName /></Link><Link href="/workspace" className="connect-back"><ArrowLeft size={16} /> Workspace</Link></header>
      <main className="connect-main">
        <div className="connect-intro"><span className="connect-kicker">ALPACA CONNECT / {trading ? "02" : "01"}</span><h1>{trading ? <>Trading access<br /><em>is a separate choice.</em></> : <>Know what<br /><em>you grant.</em></>}</h1><p>{trading ? "This permission allows Stock Steward to submit an exact order after you approve it in the workspace. Granting permission alone does not place an order." : "Connect your own Alpaca account so Stock Steward can inspect balances, positions, orders, fills, and quotes against your saved limits. This first permission cannot submit a trade."}</p><div className="connect-steps"><span className="active">01 · Review access</span><span>02 · Continue to Alpaca</span><span>03 · Return to Steward</span></div></div>
        <section className="connect-panel" aria-label="Connection permission review"><div className="connect-panel-head"><ShieldCheck size={20} /><span>{trading ? "TRADING PERMISSION" : "ACCOUNT DATA PERMISSION"}</span></div><div className="connect-panel-body"><h2>{trading ? "Authorize Stock Steward" : "Read your account. Keep control."}</h2>{trading ? <p>By allowing Stock Steward to access your Alpaca account, you are granting Stock Steward access to your account information and authorization to place transactions in your account at your direction. Alpaca does not warrant or guarantee that Stock Steward will work as advertised or expected. Before authorizing, learn more about Stock Steward.</p> : <p>Alpaca will ask you to approve account and market data access. Stock Steward uses that data to evaluate proposed buys and save decision receipts. This step does not request trading permission.</p>}<div className="connect-permissions"><div><span>ACCOUNT</span><strong>{connection ? `···${connection.accountRef.slice(-6)} · ${connection.environment}` : "Choose at Alpaca"}</strong></div><div><span>ACCESS</span><strong>{trading ? "Data + trading" : "Data only"}</strong></div><div><span>ORDER RULE</span><strong>{trading ? "Exact owner approval" : "No order submission"}</strong></div></div><p className="connect-detail"><LockKeyhole size={16} /> Alpaca handles sign-in. Stock Steward stores the resulting token encrypted on the server. Disconnecting removes the local token; saved receipts remain.</p></div><div className="connect-panel-foot"><p>{!configured ? "Alpaca Connect is not configured for this deployment yet." : trading && !connection ? "Connect the account for read-only access first." : trading && connection?.tradingScope ? "This account already granted trading access." : trading && !ready ? "Trading is disabled for this deployment." : "Continue only if these permissions match what you intend to grant."}</p><form action={`/api/broker/alpaca/start${trading ? "?intent=trading" : ""}`} method="post"><button type="submit" disabled={!ready}>Continue to Alpaca <ArrowRight size={16} /></button></form></div></section>
      </main>
      <footer className="connect-footer"><span>Stock Steward is an independent app. Alpaca decides account and app eligibility.</span><div className="connect-footer-links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/guide">Read the technical guide <ArrowRight size={14} /></Link></div></footer>
    </div>
  </div>;
}
