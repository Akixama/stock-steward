# Repository hygiene review — 2026-10-13

- `build/sites-vite-plugin.ts` is required by `vite.config.ts`; its upstream MIT license is tracked beside it.
- `vendor/shadcn-tailwind-4.13.0.css` is required by `app/globals.css`; its license is tracked beside it.
- `.openai/hosting.json` is local hosting metadata, contains binding/project identifiers rather than credentials, and remains ignored.
- Local framework output, D1 state, editor settings, audit logs and deployment logs are ignored.
- `npm test` runs all active and archived-adapter tests. Pull requests and pushes to `main` run tests, typecheck and the production build.
- `node scripts/scan-secrets.mjs` checks the working tree and full Git history. It reports only scope, commit, path and finding type.

No project license was added. The owner must choose the distribution terms before public source distribution.
