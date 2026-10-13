import assert from "node:assert/strict";
import test from "node:test";
import { oauthRedirect } from "./oauth-redirect.ts";

test("OAuth redirects preserve the state cookie on Fetch runtimes", () => {
  const destination = new URL("https://app.alpaca.markets/oauth/authorize?state=test-state");
  const cookie = "steward_alpaca_state=test-state; HttpOnly; Secure; SameSite=Lax; Path=/api/broker/alpaca/callback; Max-Age=600";
  const response = oauthRedirect(destination, cookie);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), destination.toString());
  assert.equal(response.headers.get("set-cookie"), cookie);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.body, null);
});

test("OAuth callback redirects expire the state cookie even on failure", () => {
  const response = oauthRedirect(new URL("https://example.com/workspace?broker=invalid_state"),
    "steward_alpaca_state=; HttpOnly; SameSite=Lax; Path=/api/broker/alpaca/callback; Max-Age=0");
  assert.equal(response.status, 303);
  assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
  assert.match(response.headers.get("location")!, /broker=invalid_state/);
});
