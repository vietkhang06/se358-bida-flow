# BF-QA-01 (#41): functional parity evidence

**Status: PARTIAL.** This is a comparison with repository claims and observable implementation, not sign-off against the official SRS. [The 47-row use-case matrix](../../USE_CASE_COVERAGE.md) labels every official title and acceptance criterion `UNVERIFIED`; the official SRS and private project board were unavailable. Issue #41 itself has no description or comments. Obtain the versioned SRS and board decisions before declaring 47/47 parity.

## Scope and source

Source baseline: `origin/main` at `931bbe8`. The [code-observed contract](../../PM_PLATFORM_CONTRACT_FREEZE.md) inventories **42 actions** (24 delegated, 18 legacy) and is explicitly unsigned. The app has six API routes: `/api/action`, `/api/app`, and four `/api/auth/*` routes. These counts describe code, not SRS completion. The preceding four commits on this branch implement #47, #50, #54, and #44.

## Observed comparison by the 12 repository coverage groups

| Group (provisional UC IDs) | Current behavior and execution evidence | Verdict against code claims | Missing requirement proof / dependency |
| --- | --- | --- | --- |
| System and accounts (01–06) | Auth, invitation, logout and RBAC tests passed in the integrated 157-test run; unauthenticated Worker API returned 401 | Observed working | Official actors and AC unavailable |
| Tables and rooms (07–10) | Table/pricing tests passed; dashboard derives status counts from visible effective table state in `#50` | Observed working | Browser multi-user refresh and SRS parity unverified |
| Play sessions (11–15) | Reservation/session tests and concurrency invariants passed | Observed working | Full Worker E2E incomplete |
| Reservations (16–18) | Reservation/session tests passed, including conflict handling | Observed working | Full Worker E2E incomplete |
| Pricing (19–20) | Table/pricing tests passed, including Vietnam midnight boundary | Observed working | Official rate policy unavailable |
| Orders and services (21–24) | Order/catalog and inventory tests passed | Observed working | Full Worker E2E incomplete |
| Customers and membership (25–27) | Customer/membership tests passed; E2E fixture corrected to use ADMIN for `membership.save` | Observed working in mock D1 | Full Worker E2E incomplete |
| Billing and payment (28–33) | Invoice/payment and concurrent invariant tests passed | Partial | `BF-INT-001`: `invoice.pay.method` accepts methods beyond schema enum; owned by `#42` / Zikenic |
| Inventory (34–38) | Inventory/audit and concurrent stock invariant tests passed | Observed working | Full Worker E2E incomplete |
| Shifts (39–41) | Invoice/payment and concurrent shift tests passed | Observed working in mock D1 | Full Worker E2E incomplete |
| Reports (42–45) | `#47` KPI/date filter unit tests passed; dashboard and report code merged into integrated build | Partial | KPI semantics are documented assumptions pending domain approval; remote D1/browser acceptance unavailable |
| System control (46–47) | Audit/RBAC tests passed; draft UC matrix does not assign exact UC46/47 titles | Partial | Official titles, ownership and AC unavailable |

"Observed working" means the cited automated cases ran successfully, **not** that official SRS parity passed. `tests/*.test.mjs` use an in-memory D1 fixture; the real local Worker/D1 E2E has not completed, and remote D1 is unavailable. No browser interaction was verified. `pnpm start` served `/` with HTTP 200 and 9,614 bytes on local Wrangler, but `/api/auth/status` returned 500 in that separate run because `.wrangler/state` had no `users` migration; that run is only an SSR smoke check.

## Executed checks and outstanding defects

On the previous integration test HEAD `0605f1b`: `pnpm exec tsc --noEmit --incremental false`, `pnpm lint`, `pnpm build` all passed. `pnpm test`: **157 passed / 158 total**; only `tests/pm-platform-guard.test.mjs` failed because `.github/pull_request_template.md` is missing on `main` (DevOps ownership `#45` / vietkhang06). `node scripts/with-local-wrangler.mjs scripts/perf-baseline.mjs` passed all concurrency invariants with 0 unexpected read errors; p95 read latency was 101.79 ms at c1, 436.13 ms at c5, and 2,169.2 ms at c15 on a 12-table local fixture. No approved SLA exists for #54. `node scripts/with-local-wrangler.mjs scripts/e2e-d1.mjs` failed: subsequent `GET /api/auth/status` timed out after unauthenticated guard requests; other runs returned Wrangler 503 “worker restarted mid-request.” Detailed BF-QA-02 evidence is in [BF-QA-02-real-d1-e2e.md](BF-QA-02-real-d1-e2e.md). Re-run the checks on this branch before using them as current-HEAD evidence.

## Decision to close #41

Supply the versioned official SRS/47 exact UC titles and AC, project-board decisions, and ownership mapping. Reconcile each official UC against UI, API, and D1 evidence, then rerun a complete local and dedicated remote D1 journey, browser multi-session checks, and all required CI checks on the final integration HEAD. Resolve `BF-INT-001` through its owner and the PR-template gate through its owner. Until then, #41 remains PARTIAL.
