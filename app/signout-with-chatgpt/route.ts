import { env } from "cloudflare:workers";
import { demoSessionClearedCookie } from "@/lib/demo-auth";
import { safeRelativeReturnPath } from "@/app/chatgpt-auth";

export async function GET(request: Request) {
  if (!env.STEWARD_DEMO_AUTH) return new Response("Not found", { status: 404 });
  const returnTo = safeRelativeReturnPath(new URL(request.url).searchParams.get("return_to") ?? "/");
  return new Response(null, { status: 303, headers: { location: returnTo, "set-cookie": demoSessionClearedCookie(new URL(request.url).hostname), "cache-control": "no-store" } });
}
