# BF-PLAT-02 — Ready-for-adoption shared-file ownership and PR policy

**Status: PROPOSED, NOT ADOPTED.** Suggested routing is based on the three usernames and completed GitHub Project work shown in the uploaded screenshots. It does **not** modify GitHub permissions, branch protection, or set `CODEOWNERS` without consent.

| Technical boundaries | Proposed primary coordinator | Proposed reviewer | Required coordination |
|---|---|---|---|
| `app/api/action/route.ts`, `lib/server.ts`, auth routes and access contracts | `vietkhang06` | `ja-gnahk` | Platform contract and any altered UI/API consumers |
| `lib/operations.ts`, reservation/session/order handlers, table/pricing modules | `ja-gnahk` | `vietkhang06` | UI and invoice/stock consumers |
| `db/schema.ts`, `drizzle/`, billing, customer and inventory integrations | `Zikenic` | `vietkhang06` | API/action owner and affected business module owners |
| `components/bidaflow-app.tsx` (single high-conflict UI file) | **PM-coordinated** | domain reviewer | One designated PR modifies same section at a time; split UI if major parallel work |
| `package.json`, `pnpm-lock.yaml`, `scripts/`, `.github/` | `vietkhang06` (proposed) | `Zikenic` | Announce every dependency/config change; keep lockfile consistent |

## Proposed day-to-day workflow

```bash
git switch main
git pull --ff-only origin main
git switch -c docs/BF-PM-01-baseline   # example: one task per branch
# inspect edited files; avoid unrelated changes
git status --short
git diff --check
npm test
# npm run lint and npm run build when dependencies & platform are configured
git add <only-task-files>
git commit -m "docs(pm): prepare baseline evidence and approval"
git push -u origin docs/BF-PM-01-baseline
```

PR author links the relevant issue, tells affected owners which shared paths changed, requests **at least one independent** reviewer, and merges only after required checks actually pass. Do not edit `main` directly. For cross-cutting or schema changes, ask affected consumers to verify contracts/rollback. A future CI or branch-protection task is distinct; this patch does not enable repository settings.

## Collision procedure

If two PRs edit the same file, serialize ownership per affected area. The later branch rebases or merges the updated `main`, resolves Git conflicts with domain-owner review, runs tests again, and then merges. Never silently select "ours/theirs" for schema, permissions or billing. Require versioned migration for DB changes; prohibit editing already-deployed migration snapshots.

## Approval record

| Decision | Status |
|---|---|
| Team agrees to assignee/reviewer/owner matrix | PENDING |
| Team agrees to branch/PR/change workflow | PENDING |
| Admin verifies actual ruleset/required check settings | PENDING |
| Signed by / decision link / date | PENDING |

**Done gate:** named owner/reviewer team agreement, recorded evidence, workflow test PR, and verified repository controls. See issue #5.
