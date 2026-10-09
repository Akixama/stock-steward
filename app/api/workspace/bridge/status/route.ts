import { getChatGPTUser } from "@/app/chatgpt-auth";

// Read-only bridge tracking: asks the routing API where a submitted transfer stands.
// Never submits or retries anything.
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const txHash = url.searchParams.get("txHash") ?? "";
    const fromChain = url.searchParams.get("fromChain") ?? "";
    const bridge = url.searchParams.get("bridge") ?? "";
    if (!/^0x[0-9a-f]{64}$/i.test(txHash) || !/^\d{1,6}$/.test(fromChain) || !/^[a-z0-9-_]{1,32}$/i.test(bridge)) {
      throw new Error("Invalid tracking reference.");
    }
    const params = new URLSearchParams({ txHash, fromChain, toChain: "4663", bridge });
    const response = await fetch(`https://li.quest/v1/status?${params.toString()}`, {
      headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("Bridge status unavailable.");
    const body = await response.json() as { status?: unknown; substatus?: unknown };
    return Response.json({ status: String(body.status ?? "UNKNOWN"), substatus: String(body.substatus ?? "") });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bridge status unavailable." },
      { status: 502 });
  }
}
