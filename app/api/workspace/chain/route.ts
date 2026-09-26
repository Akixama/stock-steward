import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { readChain } from "@/lib/robinhood-chain";
import { enrichObservation } from "@/lib/chain-analysis";
import { D1DecisionLedger } from "@/db/ledger";
import { claimChainRead, listChainObservations, saveChainObservation } from "@/db/chain-observations";
const headers = { "Cache-Control": "no-store" };
const valid = (address: unknown): address is string => typeof address === "string" && /^0x[0-9a-f]{40}$/i.test(address);
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  const address = new URL(request.url).searchParams.get("address");
  if (address !== null && !valid(address)) return Response.json({ error: "Enter a valid wallet address." }, { status: 400, headers });
  if (!env.DB) return Response.json({ error: "Storage unavailable." }, { status: 503, headers });
  try { return Response.json({ records: await listChainObservations(env.DB, user.userId, address ?? undefined) }, { headers }); }
  catch { return Response.json({ error: "Saved wallet observations are unavailable." }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid origin." }, { status: 403, headers });
  const text = await request.text();
  if (text.length > 200) return Response.json({ error: "Request too large." }, { status: 413, headers });
  let body: { address?: unknown } | null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!valid(body?.address)) return Response.json({ error: "Enter a valid wallet address." }, { status: 400, headers });
  if (!env.DB) return Response.json({ error: "Storage unavailable." }, { status: 503, headers });
  try {
    if (!await claimChainRead(env.DB, user.userId)) return Response.json({ error: "Wait 15 seconds between wallet reads." }, { status: 429, headers: { ...headers, "Retry-After": "15" } });
    const mandate = await new D1DecisionLedger(env.DB).getMandate(user.userId);
    const observation = await enrichObservation(await readChain(body.address), mandate);
    try { await saveChainObservation(env.DB, user.userId, observation); }
    catch { return Response.json({ observation, saved: false, warning: "Live evidence was read, but could not be saved. Retry later." }, { headers }); }
    return Response.json({ observation, saved: true }, { headers });
  } catch { return Response.json({ error: "Could not complete the Robinhood Chain observation. Registry, RPC or storage is unavailable; no holdings conclusion was made." }, { status: 503, headers }); }
}
