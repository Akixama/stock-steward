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
    // The routing API is occasionally slow or rate-limited; retry briefly before
    // telling the owner there is no route, so a hiccup never reads as a refusal.
    let lastError = "No bridge route available for this amount right now.";
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
      try {
        const response = await fetch(bridgeQuoteUrl(quoteRequest), {
          headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20000),
        });
        if (response.status === 429 || response.status >= 500) { lastError = "The routing service is busy. Try again in a moment."; continue; }
        if (!response.ok) break;
        return Response.json({ quote: trimBridgeQuote(await response.json()) });
      } catch {
        lastError = "The routing service did not answer. Try again in a moment.";
      }
    }
    throw new Error(lastError);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bridge quote unavailable." },
      { status: 422 });
  }
}
