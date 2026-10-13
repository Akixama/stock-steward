# Workspace UI and project checks — October 12, 2026

Published worker: `84496a3d-4d80-466d-ba5e-a4f690ae0784`.
Source digest: `0x0864d95d3c87c6b2b4a2f9a854933e53bb5b70bfdba506fc8eed1c2656e64c68`.

## Changes

- Replaced the oversized overview introduction and limits card with a compact operational layout.
- Grouped advanced session setup into four disclosures: draft, fees/reviews, installation/revocation, readiness/purchase test.
- Made all seven navigation tabs visible on narrow screens, with no page overflow at the inspected 390px viewport.
- Kept wallet verification recovery settings available in a disclosure instead of repeating the ownership setup by default.
- Added clearer expiry and automatic-preview wording, readable ETH fees, quote countdown, and keyboard focus outlines.
- Removed the redundant receipt action after a terminal purchase result.

## Defects corrected

- Unstable wallet setup callbacks could invalidate a parent readiness request on an unrelated render. Callbacks are now stable.
- Wallet changes invalidated pending control requests but did not clear their busy state. A changed wallet now clears busy/results and invalidates old responses.
- A stale wallet setup flow could publish an old ownership result after changing accounts. Async steps now check their generation; the verified state is bound to the address.
- Permission reviews could retain an old plan after a wallet or mandate change. Reviews now reset and reload with request invalidation; purchase panels remount for a changed wallet or mandate.
- Ownership verification and forgetting verification did not update the adjacent setup/review panels. A shared ownership change notification now reloads their read-only status.
- Copying an address displayed success before the asynchronous clipboard operation completed. Success now waits for the actual copy, with an error on failure.
- An expired permission was labeled as an out-of-range pilot limit. It now says the permission has expired.
- Automatic-start UI could consider an absent review object complete. All three explicit review flags are required.
- Corrected lint errors in the chooser, test fixture typing, and standalone script identifiers. The local EVM lab's `module` contract variable has a documented scoped exception to a Next/CommonJS-only naming rule.

## Verification

1. Code/runtime method: 340 application tests passed, TypeScript passed, production build succeeded, lint reports zero errors and 29 warnings. The warnings include request-generation ref cleanup and existing hook dependency/unused-variable warnings; they are not reported as a clean zero-warning lint run. 51 isolated contract scenarios passed against pinned real runtimes with fixture assets only. Production dependency audit reported zero known vulnerabilities.
2. Browser/production method: 19 public/auth route checks passed. Inspected all seven signed-in workspace views, wallet chooser/escape dismissal, unsaved invalid-limit rejection and reset, session/release read-only empty states, disclosure behavior and mobile navigation. No browser errors or warnings were observed in the inspected session. At 390px all seven navigation buttons fit within the viewport and page width remained below viewport width. Reset the temporary viewport afterward.

Evidence: `outputs/ui-review-tests.txt`, `ui-review-typecheck.txt`, `ui-review-build.txt`, `ui-review-lint.txt`, `ui-review-contracts.txt`, `ui-review-dependencies.json`, `ui-review-live.txt`, `ui-review-overview.png`, and `ui-review-mobile.png`.

## Limits

These checks do not prove the absence of every bug or constitute an independent security audit. Browser wallet extensions were unavailable in the inspected in-app browser. Real wallet signatures, separate-session funding, execution, expiry and revocation remain actual owner/reviewer release checks. No new wallet grant, signature, session purchase or broadcast was performed during this review. Automatic execution remains compiled off. Production had no separate session grant, fee consent, external review evidence or activation record when checked earlier in this task.

The independent review package must use this updated source digest; a previous build's approval does not cover it.
