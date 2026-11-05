# BF-PLAT-01 — Code-observed API/action contract freeze checklist

**Current status: code snapshot recorded, provider/consumer sign-off PENDING.**

- The route is `POST /api/action`, expects `{action, payload?}`, requires same-origin protection and authenticated session.
- Current success envelope: `{ok:true,data:...}`; current errors: `{error:string}`. Do not deploy a breaking switch to `{error:{...}}` without updating the UI and contract consumers.
- 24 delegated operations in `lib/operations.ts` and 18 legacy switch operations in `app/api/action/route.ts` make **42** unique actions as seen in the uploaded source.
- `docs/PM_PLATFORM_ACTION_BASELINE.json` is a generated inventory of those names plus the code-observed permission from dispatch. It is a technical guardrail, **not** a signed API agreement.
- Detail for each action's required inputs and current response is in the existing `docs/API_ACTION_CONTRACT_DRAFT.md`.

## Verification steps

```bash
node scripts/verify-pm-platform.mjs
node scripts/verify-pm-platform.mjs --strict   # mandatory before approving API freeze
node --test tests/pm-platform-guard.test.mjs
npm test
```

The default check validates the documents and **warns** about API action/permission drift from the uploaded source snapshot because local files may have changed. `--strict` exits nonzero on such drift, and must pass before API freeze approval. Neither mode changes application code. `npm test` requires the repository's normal dependencies; this patch makes no package changes.

## Open contract decisions

1. Verify requirements-to-actions mapping from the **official SRS**.
2. Provider (backend maintainer), consumer (UI maintainer) and PM/reviewer confirm each action name, payload, response, permission and error semantics.
3. Freeze the version and link approval in the signed record; then any deviation must update the manifest/doc + tests with reviewers. Changing the manifest alone is not proof of compatibility.
4. Follow-up scope: validation differences in legacy action cases, enum validation for `invoice.pay.method`, and stable machine-readable error codes. These are recognized gaps, **not** silently changed by this governance patch.

| Approval role | Name / date / source link |
|---|---|
| API provider | PENDING |
| UI consumer | PENDING |
| PM / independent reviewer | PENDING |
| Freeze version / decision link | PENDING |

**Done gate:** signed provider/consumer agreement + SRS trace + checks. See issue #4.
