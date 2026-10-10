import type { WalletProvider } from "./browser-wallet.ts";

export const MODULE_FACTORY = "0x000000000000aDdB49795b0f9bA5BC298cDda236";
export const ROLES_MASTER = "0xf2964ce6161ce0e75964fe7927ce114cb0b283d5";
// The factory creation signature, verified against real chain records. The proxy
// and the master copy travel as indexed topics with empty data.
// (Source of truth for the addresses: lib/roles-permission.ts.)
export const MODULE_CREATION_SIG = "0x2150ada912bf189ed721c44211199e270903fc88008c2a1e1e889ef30fe67c5f";

// Finds the owner's deployed-but-never-enabled permission module by reading
// creation history through the wallet's own connection. The live site's server
// cannot run this search (its chain provider refuses history searches), so the
// browser asks directly. Read-only: nothing is sent or signed.
export async function scanForOwnedModule(provider: WalletProvider, safe: string): Promise<string | null> {
  try {
    const head = await provider.request({ method: "eth_blockNumber", params: [] }) as string;
    if (!/^0x[0-9a-f]+$/i.test(head)) return null;
    const masterTopic = `0x${"0".repeat(24)}${ROLES_MASTER.slice(2).toLowerCase()}`;
    const safeTail = safe.slice(2).toLowerCase();
    let cursor = BigInt(head);
    let size = 50_000n;
    let scanned = 0n;
    while (scanned < 500_000n && cursor > 0n) {
      const from = cursor - size > 0n ? cursor - size : 0n;
      let logs: { topics?: string[] }[] | null = null;
      try {
        logs = await provider.request({ method: "eth_getLogs",
          params: [{ address: MODULE_FACTORY, topics: [MODULE_CREATION_SIG],
            fromBlock: `0x${from.toString(16)}`, toBlock: `0x${cursor.toString(16)}` }] }) as { topics?: string[] }[];
      } catch {
        size = size / 2n;
        if (size < 1_000n) return null;
        continue;
      }
      if (Array.isArray(logs)) {
        const proxies = [...new Set(logs
          .filter((entry) => entry.topics?.[2]?.toLowerCase() === masterTopic)
          .map((entry) => entry.topics?.[1])
          .filter((topic): topic is string => typeof topic === "string" && /^0x[0-9a-f]{64}$/i.test(topic))
          .map((topic) => `0x${topic.slice(-40)}`))];
        for (const proxy of proxies) {
          try {
            const owner = await provider.request({ method: "eth_call",
              params: [{ to: proxy, data: "0x8da5cb5b" }, "latest"] }) as string;
            if (typeof owner === "string" && owner.toLowerCase().endsWith(safeTail)) return proxy;
          } catch { /* Unreadable candidate; keep looking. */ }
        }
      }
      scanned += cursor - from;
      cursor = from;
      size = 50_000n;
      if (from === 0n) break;
    }
  } catch { /* Any wallet search failure simply reports nothing found. */ }
  return null;
}
