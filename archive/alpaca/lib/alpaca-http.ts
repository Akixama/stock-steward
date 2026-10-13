import type { AlpacaEnvironment } from "./alpaca-connection.ts";

export function alpacaBase(environment: AlpacaEnvironment): string {
  return environment === "live" ? "https://api.alpaca.markets" : "https://paper-api.alpaca.markets";
}

export async function alpacaGet<T>(environment: AlpacaEnvironment, token: string, path: string,
  fetcher: typeof fetch = fetch): Promise<T> {
  if (!path.startsWith("/v2/") || path.startsWith("//")) throw new Error("Invalid Alpaca API path.");
  const response = await fetcher(`${alpacaBase(environment)}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Alpaca account request failed (${response.status}). No decision was made.`);
  return response.json() as Promise<T>;
}
