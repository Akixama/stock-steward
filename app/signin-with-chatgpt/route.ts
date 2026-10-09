import { env } from "cloudflare:workers";
import { issueDemoSession, demoSessionCookie, verifyDemoSession, DEMO_COOKIE_NAME } from "@/lib/demo-auth";
import { safeRelativeReturnPath } from "@/app/chatgpt-auth";

async function currentIdentity(request: Request) {
  const secret = env.STEWARD_DEMO_AUTH;
  if (!secret) return null;
  const match = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${DEMO_COOKIE_NAME}=([^;]+)`));
  return match ? verifyDemoSession(secret, match[1]) : null;
}

// Demo sign-in for self-hosted previews. Off the ChatGPT platform there is no identity
// provider, so each visitor gets their own practice identity in an HMAC-signed cookie.
// Inactive unless the deployment sets STEWARD_DEMO_AUTH.

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));

export async function GET(request: Request) {
  if (!env.STEWARD_DEMO_AUTH) return new Response("Not found", { status: 404 });
  const returnTo = safeRelativeReturnPath(new URL(request.url).searchParams.get("return_to") ?? "/");
  // A signed-in visitor keeps their workspace; never show a sign-in form that could replace it.
  if (await currentIdentity(request)) return new Response(null, { status: 303, headers: { location: returnTo, "cache-control": "no-store" } });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Stock Steward</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1115;color:#e8e6e1;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{width:min(420px,90vw);background:#171a21;border:1px solid #262b36;border-radius:14px;padding:32px}
h1{font-size:20px;margin:0 0 6px}p{color:#9aa3b2;font-size:14px;margin:0 0 18px}
label{display:block;font-size:13px;color:#9aa3b2;margin:0 0 6px}
input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:9px;border:1px solid #2c3342;background:#10131a;color:#e8e6e1;font-size:15px}
button{width:100%;margin-top:16px;padding:12px;border-radius:9px;border:0;background:#e8e6e1;color:#14161c;font-size:15px;font-weight:600;cursor:pointer}
button:hover{background:#fff}
footer{margin-top:14px;font-size:12px;color:#6b7383}
</style></head><body><main>
<h1>Stock Steward</h1>
<p>Practice mode with real market prices. No real money and no real brokerage accounts are used here. Each visitor gets their own practice workspace.</p>
<form method="post" action="/signin-with-chatgpt">
<input type="hidden" name="return_to" value="${escapeHtml(returnTo)}">
<label for="display_name">Name shown in the workspace (optional)</label>
<input id="display_name" name="display_name" maxlength="32" placeholder="Your name" autocomplete="nickname">
<button type="submit">Enter</button>
</form>
<footer>Practice mode. Nothing here trades or moves funds.</footer>
</main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } });
}

export async function POST(request: Request) {
  if (!env.STEWARD_DEMO_AUTH) return new Response("Not found", { status: 404 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response("Invalid request origin.", { status: 403 });
  const form = await request.formData().catch(() => null);
  const returnTo = safeRelativeReturnPath(String(form?.get("return_to") ?? "/"));
  // Re-submitting the form must never replace a valid identity; the workspace would be lost.
  if (await currentIdentity(request)) return new Response(null, { status: 303, headers: { location: returnTo, "cache-control": "no-store" } });
  const issued = await issueDemoSession(env.STEWARD_DEMO_AUTH, String(form?.get("display_name") ?? ""));
  if (!issued) return new Response("Demo sign-in is unavailable.", { status: 503 });
  return new Response(null, { status: 303, headers: { location: returnTo, "set-cookie": demoSessionCookie(issued.cookieValue), "cache-control": "no-store" } });
}
