# Stock Steward background scheduler

This separate Cloudflare Worker requests the existing protected read-only/fake-money tick every 15 minutes. It has no database, brokerage credentials, wallet keys, or transaction signer. The Stock Steward endpoint still owns its database lease and all eligibility checks. Keep the GitHub Actions schedule in place until a real Cloudflare Cron wake is verified, then remove the duplicate schedule while retaining manual dispatch.

Deployment requires access to a Cloudflare account. Run these steps from the repository root with the repository's Wrangler dependency:

1. Authenticate with Cloudflare (`wrangler login`).
2. Deploy with `wrangler deploy --config scheduler/wrangler.jsonc`.
3. Configure the same 64-character `STEWARD_WORKER_KEY` secret used by the Stock Steward endpoint through `wrangler secret put STEWARD_WORKER_KEY --config scheduler/wrangler.jsonc`. Never put the key in source control. If its existing value is unavailable, rotate the Site and GitHub secrets together before enabling this trigger.
4. Confirm the Cron Trigger is active in Cloudflare and inspect a scheduled invocation. Verify a new background receipt in Stock Steward with the workspace tab closed. Cron runs on UTC quarter hours.

Cloudflare Cron Triggers can take several minutes to propagate after deployment. A successful deployment alone does not prove that a wake occurred.
