# Local and production runbook

## Local development

Use Node.js 22.13 or newer.

```sh
npm ci
npm run build
npm run db:local:apply
npm run dev
```

The build creates `dist/server/wrangler.json`. Local D1 state is kept under ignored `.wrangler/` storage. The local preview uses a development sign-in identity.

## Database migrations

`npm run db:local:apply` applies every `drizzle/0*.sql` file in lexical order to the local D1 database. Production migrations must be reviewed and applied in the same order with Wrangler and the production config. Never remove or reorder an applied migration.

## Cloudflare deployment

1. Run tests, typecheck, lint, the production build and the permission lab.
2. Run `node scripts/audit-deploy-config.mjs`.
3. Confirm the Worker name, D1 binding and custom-domain routes in `dist/server/wrangler.json`.
4. Apply unapplied migrations to the remote D1 database.
5. Configure server secrets through Cloudflare. Never put them in browser variables or source control.
6. Deploy with Wrangler using `dist/server/wrangler.json`.
7. Run `node scripts/audit-live-site.mjs` and complete authenticated desktop and mobile review.

The demo sign-in uses `STEWARD_DEMO_AUTH`. Read-only scheduled wakes use a matching `STEWARD_WORKER_KEY` in the site and scheduler. AI drafting uses a private Workers AI binding or server credentials. The chain reader uses `ALCHEMY_API_KEY`. Automatic trading remains disabled regardless of these settings.

## Visibility flags

`SHOW_DEVELOPER_TOOLS=true` exposes diagnostic route, monitoring and transaction watch controls. Automatic real-money trading is shelved in source and cannot be enabled through a hosting environment variable. See `docs/automatic-trading-shelved.md` before planning a later release.

## Operational rules

- Never resend an uncertain transaction. Recheck its saved hash and intent.
- Never substitute latest state for historical state at a transaction block.
- Do not release pending spend without terminal evidence.
- Revoke or pause through the owner flow; do not edit database state to simulate revocation.
- Code changes invalidate source-bound external review evidence and require a new review package.
