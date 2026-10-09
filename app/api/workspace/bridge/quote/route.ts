import { getChatGPTUser } from "@/app/chatgpt-auth";
import { bridgeQuoteUrl, trimBridgeQuote, validateBridgeQuoteRequest } from "@/lib/bridge";

// Fetches a bridge quote for the owner's own address. Read-only: no signature,
// no transaction. The destination is fixed to USDG on Robinhood Chain.
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const body = await request.json().catch(() => null);
    const quoteRequest = validateBridgeQuoteRequest(body);
    const response = await fetch(bridgeQuoteUrl(quoteRequest), {
      headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("No bridge route available for this amount right now.");
    return Response.json({ quote: trimBridgeQuote(await response.json()) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bridge quote unavailable." },
      { status: 422 });
  }
}
