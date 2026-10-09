import { env } from "cloudflare:workers";

export type AlpacaEnvironment = "live" | "paper";
export type AlpacaConnection = {
  accountRef: string;
  environment: AlpacaEnvironment;
  connectedAt: string;
  token: string;
  tradingScope: boolean;
};

export function alpacaConfigured(): boolean {
  return Boolean(env.DB && env.ALPACA_CLIENT_ID && env.ALPACA_CLIENT_SECRET &&
    env.ALPACA_REDIRECT_URI && env.ALPACA_TOKEN_ENCRYPTION_KEY &&
    ["live", "paper"].includes(env.ALPACA_ENV ?? ""));
}

export function alpacaEnvironment(): AlpacaEnvironment {
  if (env.ALPACA_ENV !== "live" && env.ALPACA_ENV !== "paper") {
    throw new Error("Alpaca environment is not configured.");
  }
  return env.ALPACA_ENV;
}

export function alpacaOrderSubmissionEnabled(environment: AlpacaEnvironment): boolean {
  // The submission switch is explicit per environment: ALPACA_ORDER_SUBMISSION_MODE lists
  // each allowed environment by name (e.g. "paper" or "paper,live"). Anything absent
  // cannot submit, so live stays off until the deployment names it.
  const modes = (env.ALPACA_ORDER_SUBMISSION_MODE ?? "").split(",").map((value) => value.trim());
  return alpacaConfigured() && modes.includes(environment);
}

const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

async function encryptionKey(): Promise<CryptoKey> {
  const raw = env.ALPACA_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Broker token encryption is unavailable.");
  const bytes = decode(raw);
  if (bytes.length !== 32) throw new Error("Broker token encryption key must be 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function saveAlpacaConnection(db: D1Database, ownerRef: string, accountRef: string,
  environment: AlpacaEnvironment, token: string, tradingScope = false): Promise<void> {
  if (!ownerRef || !accountRef || !token) throw new Error("Incomplete broker connection.");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(),
    new TextEncoder().encode(token));
  // One row per owner and environment: a paper connection survives a live connect and
  // each keeps its own trading grant.
  await db.prepare(`INSERT INTO broker_connections
    (owner_ref, broker, account_ref, environment, token_iv, token_ciphertext, connected_at, trading_scope)
    VALUES (?, 'alpaca', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_ref, broker, environment) DO UPDATE SET account_ref = excluded.account_ref,
      token_iv = excluded.token_iv,
      token_ciphertext = excluded.token_ciphertext, connected_at = excluded.connected_at,
      trading_scope = excluded.trading_scope`)
    .bind(ownerRef, accountRef, environment, encode(iv), encode(new Uint8Array(ciphertext)),
      new Date().toISOString(), tradingScope ? 1 : 0).run();
}

export async function getAlpacaConnection(db: D1Database, ownerRef: string,
  environment?: AlpacaEnvironment): Promise<AlpacaConnection | null> {
  // Without an explicit environment the live connection is the money context when one
  // exists; paper otherwise. The automatic agent always names paper itself.
  const rows = await db.prepare(`SELECT account_ref, environment, token_iv, token_ciphertext, connected_at, trading_scope
    FROM broker_connections WHERE owner_ref = ? AND broker = 'alpaca'`)
    .bind(ownerRef).all<{ account_ref: string; environment: string; token_iv: string;
      token_ciphertext: string; connected_at: string; trading_scope: number }>();
  const matching = rows.results.filter((row) => {
    if (row.environment !== "live" && row.environment !== "paper") return false;
    return environment ? row.environment === environment : true;
  });
  const row = environment ? matching[0] : matching.find((candidate) => candidate.environment === "live") ?? matching[0];
  if (!row) return null;
  if (row.environment !== "live" && row.environment !== "paper") throw new Error("Invalid broker environment.");
  const token = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(row.token_iv) },
    await encryptionKey(), decode(row.token_ciphertext));
  return { accountRef: row.account_ref, environment: row.environment,
    connectedAt: row.connected_at, token: new TextDecoder().decode(token),
    tradingScope: row.trading_scope === 1 };
}

export async function removeAlpacaConnection(db: D1Database, ownerRef: string): Promise<void> {
  await db.prepare("DELETE FROM broker_connections WHERE owner_ref = ? AND broker = 'alpaca'")
    .bind(ownerRef).run();
}
