# Server AI setup (site owner only)

Visitors do not download a model or create a provider account. The integration is inactive until all runtime values are configured.

1. Create a Cloudflare account and stay on **Workers Free**. Do not enable a paid plan or prepaid gateway.
2. Open Workers AI → Use REST API → Create a Workers AI API Token. Scope it to Workers AI Read/Edit for your account. Record your Account ID.
3. Store the token privately as a Sites secret: CLOUDFLARE_AI_API_TOKEN. Store CLOUDFLARE_AI_ACCOUNT_ID as the account ID and STEWARD_AI_ENABLED=true. Never paste the token into chat or commit it.
4. Publish to apply the environment revision, then test Interpret with a complete direction. Compare returned draft amounts, triggers and approval choice before confirmation.

Fixed model: @cf/meta/llama-3.1-8b-instruct; JSON schema output; 900 output-token maximum; 25-second timeout; no automatic retries or paid fallback.

The database atomically reserves attempts before requests: 50 per UTC day site-wide, 10 per user, 15-second user cooldown. Failed calls and rejected user reservations conservatively consume the global cap. No prompts are stored in this usage table. Cloudflare's own free allowance is the billing backstop, including other applications on the same account. App request caps alone do not guarantee a zero bill on an account upgraded to Paid.

Only direction text and a fixed extraction instruction/schema go to Cloudflare. Draft fields are validated server-side and again client-side. The endpoint has no trade, grant or wallet-signing capability. Missing config, storage failure, provider rejection or invalid output blocks interpretation, leaving manual rule entry available.

Provider generation cannot be verified until credentials are configured; mocked transport tests do not establish model accuracy.

Docs: https://developers.cloudflare.com/workers-ai/get-started/rest-api/ and https://developers.cloudflare.com/workers-ai/platform/pricing/
