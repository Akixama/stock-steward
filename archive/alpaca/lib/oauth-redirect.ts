/** Construct cookie-bearing redirects with mutable headers on Fetch runtimes. */
export function oauthRedirect(destination: URL, cookie: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: destination.toString(), "Set-Cookie": cookie, "Cache-Control": "no-store" },
  });
}
