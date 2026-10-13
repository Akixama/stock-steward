# Server AI setup (site owner only)

Visitors do not download a model or create a provider account. Production uses a native Cloudflare Workers AI binding; visitors need only their Stock Steward login.

1. Create a Cloudflare account and stay on **Workers Free**. Do not enable a paid plan or prepaid gateway.
2. Configure `ai: { binding: "AI" }` on the Worker and `STEWARD_AI_ENABLED=true`. The deployment configuration helper preserves these settings after each build. No separate AI API token is needed for the native binding.
3. For a host without native bindings, the REST fallback accepts private server variables `CLOUDFLARE_AI_API_TOKEN` and `CLOUDFLARE_AI_ACCOUNT_ID`. Never paste a token into chat or commit it.
4. Publish to apply the environment revision, then test Interpret with a complete direction. Compare returned draft amounts, triggers and approval choice before confirmation.

Fixed model: @cf/meta/llama-3.1-8b-instruct-fp8; JSON object mode with the full extraction schema in the instruction and strict server-side schema validation; 900 output-token maximum; 25-second timeout; no automatic retries or paid fallback. The previous non-FP8 model was retired on May 30, 2026 and returned provider error 5028 during live verification. Provider grammar compilation rejected the nullable schema (5025), so validation is performed by the application instead.

The database atomically reserves attempts before requests: 50 per UTC day site-wide, 10 per user, 15-second user cooldown. Failed calls and rejected user reservations conservatively consume the global cap. No prompts are stored in this usage table. Cloudflare's own free allowance is the billing backstop, including other applications on the same account. App request caps alone do not guarantee a zero bill on an account upgraded to Paid.

Only direction text and a fixed extraction instruction/schema go to Cloudflare. Draft fields are validated server-side and again client-side. The endpoint has no trade, grant or wallet-signing capability. Missing config, storage failure, provider rejection or invalid output blocks interpretation, leaving manual rule entry available.

Live verification on October 10: a complete synthetic scheduled-buy direction produced the expected $1 AAPL / 24 hours / $20 reserve / approval draft. An incomplete direction failed closed without a usable draft or activation. This is evidence for those cases, not a general model-accuracy claim. Never activate a test draft on a user's behalf.

Docs: https://developers.cloudflare.com/workers-ai/configuration/bindings/, https://developers.cloudflare.com/workers-ai/platform/pricing/, and https://developers.cloudflare.com/changelog/post/2026-05-08-planned-model-deprecations/
