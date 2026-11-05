# Five in-progress tasks — evidence & closeout status (2026-11-05)

Repository snapshot: user-uploaded `se358-bida-flow-main.zip`; goal reference: `BidaFlow-full-source-v3.zip`. Board screenshot displayed five In progress issues #1–#5. This patch adds **reviewable artifacts and automated source drift detection only**; it does not represent sponsor, PM or team approvals.

| Issue | Deliverable added by this patch | Remaining gate for Done | Status recommendation |
|---|---|---|---|
| [#1 BF-PM-01](https://github.com/vietkhang06/se358-bida-flow/issues/1) | [`PM_SCHEDULE_BASELINE_DECISION.md`](PM_SCHEDULE_BASELINE_DECISION.md) | Signed Charter/Schedule text and sponsor decision | **Keep In progress / Blocked** |
| [#2 BF-PM-02](https://github.com/vietkhang06/se358-bida-flow/issues/2) | [`PM_UC_SOURCE_RECONCILIATION.csv`](PM_UC_SOURCE_RECONCILIATION.csv), [`PM_USE_CASE_RECONCILIATION_RUNBOOK.md`](PM_USE_CASE_RECONCILIATION_RUNBOOK.md) | Signed SRS, all official UC rows and UC47 ownership review | **Keep In progress / Blocked** |
| [#3 BF-PM-03](https://github.com/vietkhang06/se358-bida-flow/issues/3) | [`PM_WBS_TASK_OWNER_MAP.csv`](PM_WBS_TASK_OWNER_MAP.csv), [`PM_WBS_CHANGE_CONTROL.md`](PM_WBS_CHANGE_CONTROL.md) | Official WBS dependencies and adopted policy | **Keep In progress** |
| [#4 BF-PLAT-01](https://github.com/vietkhang06/se358-bida-flow/issues/4) | [`PM_PLATFORM_ACTION_BASELINE.json`](PM_PLATFORM_ACTION_BASELINE.json), [`PM_PLATFORM_CONTRACT_FREEZE.md`](PM_PLATFORM_CONTRACT_FREEZE.md), automated guard | Provider/consumer contract approval + SRS trace | **Keep In progress** |
| [#5 BF-PLAT-02](https://github.com/vietkhang06/se358-bida-flow/issues/5) | [`PM_SHARED_FILE_GIT_POLICY.md`](PM_SHARED_FILE_GIT_POLICY.md), `.github/pull_request_template.md` | Owner/team consent and GitHub settings check | **Keep In progress** |

## Safe scope & compatibility

- **No existing app, DB, migration, dependency, lockfile, or package script is overwritten.** All patch files are new paths relative to the uploaded snapshot.
- The PR template and guard test are opt-in/additive; running npm tests includes the new guard test, which rejects **undocumented contract drift** deliberately.
- Proposed task/reviewer assignments are not authority. UC47 is not inferred from code.
- Versioned source documents and approvals must be provided by the appropriate humans; any automated closure without them would be misreporting.

## Before marking any GitHub Project item Done

1. Attach the authoritative input and final decision/evidence link to the corresponding issue.
2. Obtain the role-appropriate written sign-off shown above.
3. Check that the approved WBS/Project fields and relevant evidence align; don't use document creation alone as acceptance.
4. Update status via authorized GitHub Project workflow.
