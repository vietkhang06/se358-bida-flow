# BF-QA-02 (#44): D1 end-to-end verification

Status: **BLOCKED**. The issue has no body or comments; its title requires a real Cloudflare D1 run. Neither a dedicated remote D1 binding nor staging URL and credentials are available. `pnpm exec wrangler whoami` reports unauthenticated. Local D1 results do not satisfy that requirement.

## Test design

`scripts/with-local-wrangler.mjs` creates a temporary Wrangler state directory, applies `drizzle/0000_natural_silvermane.sql`, runs `scripts/e2e-d1.mjs` through the built Worker, then removes the temporary state. The E2E uses a unique `QA-E2E-*` tag, validates auth and RBAC, catalog and inventory, reservation/session/order, invoice/payment/shift, D1 reads after mutations, and logout. It deactivates created catalog records and locks invited test staff. On a persistent remote staging database, its audit and transaction history remain by design; use a dedicated disposable staging database. The script refuses a non-loopback URL unless `BIDAFLOW_E2E_ALLOW_REMOTE=1` and `BIDAFLOW_E2E_ENV=staging` are both set. Never point it at production.

## Executed on local Worker and D1

| Case | Preconditions/data | Steps and expected result | Actual result | Status |
| --- | --- | --- | --- | --- |
| E2E-01 | Isolated migrated local D1 | Unauthenticated `/api/app` and `/api/action` return 401 | Both returned 401 in a run that reached `membership.save` | PASS in that run |
| E2E-02 | Fresh local D1 | Wrong setup code returns 403; admin registration returns 201 | Both passed in the first run, which later stopped at a test-role mismatch | PASS in that run |
| E2E-03 | Fresh local D1 | Staff invite, RBAC, and catalog mutations persist | First run reached `membership.save`; fixture had incorrectly used CASHIER, which lacks `MEMBERSHIPS_MANAGE`; corrected to ADMIN | PARTIAL |
| E2E-04–08 | Fresh local D1 | Reservation through payment, cleanup, and logout | Reruns failed before completion: Wrangler returned `503 Your worker restarted mid-request`, or the following `GET /api/auth/status` timed out after 15 seconds | BLOCKED |
| Remote-D1 | Dedicated Cloudflare staging D1 | Run E2E through staging Worker and verify persistence | No Wrangler login, remote binding/database ID, or staging URL | BLOCKED |

Commands run: `pnpm build` PASS; `pnpm exec tsc --noEmit --incremental false` PASS; `pnpm lint` PASS; `pnpm test` 137/138 PASS (baseline `tests/pm-platform-guard.test.mjs` fails because `.github/pull_request_template.md` is missing); `node scripts/with-local-wrangler.mjs scripts/e2e-d1.mjs` FAIL as above. These results are local only; no remote CI result exists.

To continue: resolve the local Wrangler restart/timeout, then rerun the local E2E to completion. For the required remote run, supply an isolated Cloudflare staging D1 and Worker URL, verify the deployed binding and migration, and set staging-only credentials through the environment. Record returned IDs and D1 readback without secrets, then check cleanup and all invariants. Do not mark #44 DONE until the full remote run and required CI pass.
