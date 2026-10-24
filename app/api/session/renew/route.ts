import { env } from "cloudflare:workers";
import { DEMO_COOKIE_NAME, SESSION_LIFETIME_MS, demoSessionCookie, reissueDemoSession, shouldRenewSession, verifyDemoSession } from "@/lib/demo-auth";

const headers = { "Cache-Control": "no-store" };

// Called when the workspace opens. Renews a valid, signed session to a fresh 30 days
// (at most once a day). It never creates an identity or changes which workspace is open.
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid origin." }, { status: 403, headers });
  const secret = env.STEWARD_DEMO_AUTH;
  if (!secret) return Response.json({ renewed: false }, { headers });
  const match = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\s*)${DEMO_COOKIE_NAME}=([^;]+)`));
  const identity = match ? await verifyDemoSession(secret, match[1]) : null;
  if (!identity) return Response.json({ renewed: false }, { status: 401, headers });
  if (!shouldRenewSession(identity.expiresAt)) return Response.json({ renewed: false }, { headers });
  const renewed = await reissueDemoSession(secret, identity, Date.now(), SESSION_LIFETIME_MS);
  if (!renewed) return Response.json({ renewed: false }, { status: 503, headers });
  return Response.json({ renewed: true }, { headers: { ...headers, "Set-Cookie": demoSessionCookie(renewed.cookieValue, SESSION_LIFETIME_MS / 1000, new URL(request.url).hostname) } });
}
