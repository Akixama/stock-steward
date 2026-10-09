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
  return alpacaConfigured() && env.ALPACA_ENV === environment &&
    env.ALPACA_ORDER_SUBMISSION_MODE === environment;
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
  await db.prepare(`INSERT INTO broker_connections
    (owner_ref, broker, account_ref, environment, token_iv, token_ciphertext, connected_at, trading_scope)
    VALUES (?, 'alpaca', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_ref) DO UPDATE SET broker = 'alpaca', account_ref = excluded.account_ref,
      environment = excluded.environment, token_iv = excluded.token_iv,
      token_ciphertext = excluded.token_ciphertext, connected_at = excluded.connected_at,
      trading_scope = excluded.trading_scope`)
    .bind(ownerRef, accountRef, environment, encode(iv), encode(new Uint8Array(ciphertext)),
      new Date().toISOString(), tradingScope ? 1 : 0).run();
}

export async function getAlpacaConnection(db: D1Database, ownerRef: string): Promise<AlpacaConnection | null> {
  const row = await db.prepare(`SELECT account_ref, environment, token_iv, token_ciphertext, connected_at, trading_scope
    FROM broker_connections WHERE owner_ref = ? AND broker = 'alpaca'`)
    .bind(ownerRef).first<{ account_ref: string; environment: string; token_iv: string;
      token_ciphertext: string; connected_at: string; trading_scope: number }>();
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
