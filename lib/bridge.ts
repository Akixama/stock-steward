import { parseUnits } from "viem";

// In-Steward bridging configuration. The destination is fixed: USDG on Robinhood
// Chain to the owner's own address. Quotes come from the public LI.FI API; every
// transfer is signed in the owner's own wallet and settles at the quoted bridge.
// Stock Steward never holds or carries funds.
export const BRIDGE_CHAIN_ID = 4663;

// The only permitted destinations: USDG (buying power) or native ETH (gas), both
// on Robinhood Chain, always to the owner's own address. Anything else is refused.
export const BRIDGE_DESTINATIONS = [
  {
    token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    symbol: "USDG",
    decimals: 6,
    blurb: "buying power",
  },
  {
    token: "0x0000000000000000000000000000000000000000",
    symbol: "ETH",
    decimals: 18,
    blurb: "gas",
  },
] as const;

export type BridgeDestination = (typeof BRIDGE_DESTINATIONS)[number];

export type BridgeSource = {
  chainId: 1 | 8453;
  chainName: string;
  chainHex: string;
  tokens: { symbol: "ETH" | "USDC"; address: string; decimals: number }[];
};

export const BRIDGE_SOURCES: BridgeSource[] = [
  {
    chainId: 1,
    chainName: "Ethereum",
    chainHex: "0x1",
    tokens: [
      { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18 },
      { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    ],
  },
  {
    chainId: 8453,
    chainName: "Base",
    chainHex: "0x2105",
    tokens: [
      { symbol: "ETH", address: "0x0000000000000000000000000000000000000000", decimals: 18 },
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA4b4", decimals: 6 },
    ],
  },
];

export type BridgeQuoteRequest = {
  fromChainId: number;
  fromToken: string;
  fromAmountRaw: string;
  fromAddress: string;
  toToken: string;
};

export type BridgeQuote = {
  tool: string;
  toAmountRaw: string;
  toAmountUSD: string | null;
  estimatedSeconds: number | null;
  transactionRequest: { to: string; data: string; value: string; gasLimit?: string };
};

export function parseBridgeAmount(input: string, decimals: number): string {
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,18})?$/.test(input.trim())) throw new Error("Enter a positive amount.");
  const raw = parseUnits(input.trim(), decimals);
  if (raw <= 0n) throw new Error("Enter a positive amount.");
  return raw.toString();
}

export function validateBridgeQuoteRequest(body: unknown): BridgeQuoteRequest {
  if (!body || typeof body !== "object") throw new Error("Invalid bridge request.");
  const { fromChainId, fromToken, fromAmountRaw, fromAddress, toToken } = body as Record<string, unknown>;
  const source = BRIDGE_SOURCES.find((candidate) => candidate.chainId === fromChainId);
  if (!source) throw new Error("Unsupported source chain.");
  const token = source.tokens.find((candidate) => candidate.address.toLowerCase() === String(fromToken ?? "").toLowerCase());
  if (!token) throw new Error("Unsupported source token.");
  const destination = BRIDGE_DESTINATIONS.find(
    (candidate) => candidate.token.toLowerCase() === String(toToken ?? "").toLowerCase());
  if (!destination) throw new Error("Unsupported destination token.");
  if (typeof fromAmountRaw !== "string" || !/^\d+$/.test(fromAmountRaw) || BigInt(fromAmountRaw) <= 0n) {
    throw new Error("Invalid amount.");
  }
  if (typeof fromAddress !== "string" || !/^0x[0-9a-f]{40}$/i.test(fromAddress)) {
    throw new Error("Invalid wallet address.");
  }
  return { fromChainId: source.chainId, fromToken: token.address, fromAmountRaw, fromAddress, toToken: destination.token };
}

export function bridgeQuoteUrl(request: BridgeQuoteRequest): string {
  const params = new URLSearchParams({
    fromChain: String(request.fromChainId),
    toChain: String(BRIDGE_CHAIN_ID),
    fromToken: request.fromToken,
    toToken: request.toToken,
    fromAmount: request.fromAmountRaw,
    fromAddress: request.fromAddress,
    slippage: "0.03",
    integrator: "stock-steward",
  });
  return `https://li.quest/v1/quote?${params.toString()}`;
}

export function trimBridgeQuote(raw: unknown): BridgeQuote {
  const quote = raw as {
    tool?: unknown; estimate?: { toAmount?: unknown; toAmountUSD?: unknown; executionDuration?: unknown };
    transactionRequest?: { to?: unknown; data?: unknown; value?: unknown; gasLimit?: unknown };
  };
  if (typeof quote?.tool !== "string" || !quote.tool) throw new Error("No bridge route available for this amount right now.");
  const tx = quote.transactionRequest;
  if (!tx || typeof tx.to !== "string" || typeof tx.data !== "string" || typeof tx.value !== "string") {
    throw new Error("The bridge returned an incomplete transaction.");
  }
  return {
    tool: quote.tool,
    toAmountRaw: String(quote.estimate?.toAmount ?? ""),
    toAmountUSD: quote.estimate?.toAmountUSD != null ? String(quote.estimate.toAmountUSD) : null,
    estimatedSeconds: typeof quote.estimate?.executionDuration === "number" ? quote.estimate.executionDuration : null,
    transactionRequest: { to: tx.to, data: tx.data, value: tx.value,
      ...(typeof tx.gasLimit === "string" ? { gasLimit: tx.gasLimit } : {}) },
  };
}

export function formatTokenAmount(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) return "—";
  const padded = raw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = decimals >= 2 ? padded.slice(-decimals, -decimals + 2) : "00";
  return `${whole}.${fraction}`;
}

export function formatUsdg(raw: string): string {
  return formatTokenAmount(raw, 6);
}
