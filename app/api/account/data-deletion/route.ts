import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.redirect(new URL("/account", request.url), 303);
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
  }
  if (!env.DB) return Response.json({ error: "Request storage is unavailable." }, { status: 503 });

  try {
    await env.DB.prepare(`INSERT INTO data_deletion_requests (owner_ref, email, requested_at, state)
      VALUES (?, ?, ?, 'requested') ON CONFLICT(owner_ref) DO NOTHING`)
      .bind(user.userId, user.email, new Date().toISOString()).run();
    return Response.redirect(new URL("/account?data=requested", request.url), 303);
  } catch (error) {
    console.error("Data deletion request failed", error);
    return Response.json({ error: "Could not save your request. Please email support from your sign-in address." }, { status: 503 });
  }
}
