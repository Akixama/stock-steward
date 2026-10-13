# Testing and verification

## Standard checks

```sh
npm test
npx tsc --noEmit
npm run lint
npm run build
```

`npm test` runs the active application and database tests plus the archived Alpaca adapter tests. Tests use fixtures and local SQLite or D1-compatible adapters; they do not submit live orders.

## Permission laboratory

```sh
node --experimental-transform-types permission-lab/test.mjs
node --experimental-transform-types permission-lab/test.mjs --actual-router
```

The actual-router mode loads pinned mainnet runtime bytecode into an isolated Cancun EVM and uses local fixture assets and liquidity. It validates permission mechanics, not a live mainnet swap, current prices, eligibility, setup affordability or an external security review.

## Release checks

Use `scripts/audit-deploy-config.mjs` before deployment and `scripts/audit-live-site.mjs` after deployment. The live audit covers public pages, authentication boundaries and protected routes. Browser review should cover all workspace views, Strategy, Guide, wallet-disconnected states and mobile layout without authorizing financial actions.

Dependency and secret scans are separate release gates. Never print discovered values in logs. A real finding should be identified by file, commit and type, then rotated before release.

## Windows note

On the original Windows development host, Drizzle generation needed a temporary `os.userInfo()` preload for a CLI dependency. This is a host-specific tooling workaround and does not affect runtime behavior.
