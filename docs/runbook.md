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

Never deploy straight from a fresh clone with `wrangler deploy`: the generated config names a placeholder Worker and database until step 2 rewrites it.

### Rolling back

Wrangler prints a version ID on every deploy. To return to an earlier version (no rebuild needed):

```
node node_modules/wrangler/bin/wrangler.js deployments list --name stock-steward
node node_modules/wrangler/bin/wrangler.js rollback <version-id> --name stock-steward
```

Recent known-good versions: `656338a1-1074-4684-a3df-2481ad410158` ("Earlier buy ideas" label), `7c61439c-206b-42b4-9098-da4afabdd5b6` (plain wording in Strategy → Real money), `a504010e-b622-47e4-83a8-45ce24692f27` (five tabs + saved goal in Strategy), `b0c18f95-16fa-4f19-b40d-574d876b1647` (five tabs), `0fc96abd-8ce1-449c-9835-e7750dc88a8f` (before five tabs).

The demo sign-in uses `STEWARD_DEMO_AUTH`. Scheduled wakes use a matching `STEWARD_WORKER_KEY` in the site and scheduler. AI drafting uses a private Workers AI binding or server credentials. The chain reader uses `ALCHEMY_API_KEY`. This branch's release config stages Shadow checks only; notification proposals and automatic buying remain off. See `docs/automatic-stages-review.md`.

## Visibility flags

`SHOW_DEVELOPER_TOOLS=true` exposes diagnostic route, monitoring and transaction watch controls. Automatic-stage flags default off. Before changing them, review `config/automatic-stages-release.json`, the migration, signed-session prerequisites and `docs/automatic-stages-review.md`.

## Operational rules

- Never resend an uncertain transaction. Recheck its saved hash and intent.
- Never substitute latest state for historical state at a transaction block.
- Do not release pending spend without terminal evidence.
- Revoke or pause through the owner flow; do not edit database state to simulate revocation.
- Code changes invalidate source-bound external review evidence and require a new review package.
