# BF-PM-03 — WBS owner/dependency map & schedule-change procedure

**Approval state: PROPOSED.** `PM_WBS_TASK_OWNER_MAP.csv` includes the six visible board tasks #1–#6 and their current assignees; each task estimate is 2 **Project estimate units** shown in the screenshot, treated as story points for planning convenience, not as guaranteed hours. Proposed reviewer/dependency values require the official WBS/tracker before adoption.

## Fields in the baseline

- Stable Task ID and WBS Activity ID (copy the latter **only from the official WBS**), exact task label, linked GitHub issue.
- Requirement / UC trace, owner, reviewer, planned start/end, estimate, predecessor and successor, risk, exit evidence.
- Baseline version/date, actual dates, change request ID, approval and rollback instruction. Do not overwrite baseline/actual with today's date.

## Suggested rules pending team sign-off

1. No tasks in `Done` solely because code exists or a PR was merged. Acceptance criteria, tests, and reviewer evidence must be linked.
2. One accountable assignee per task and a different reviewer. Shared files require prior coordination before simultaneous changes.
3. Before any baseline date or owner changes: raise a change request with issue/UC/WBS IDs, reason, affected dependency chain, test/release/UAT impact, risk and estimate delta.
4. Obtain authorized approval, record approver/date and old/new baseline. Update affected WBS and GitHub Project fields together with a change-log reference; do not rewrite historical actuals.
5. Validate no circular task dependencies; do not claim dependency completion without evidence.

## Change request template

| Field | Entry |
|---|---|
| Change ID / requester / date | PENDING |
| Task / UC / WBS | PENDING |
| Current approved baseline | PENDING |
| Proposed new baseline | PENDING |
| Dependency / cost / test / UAT impact | PENDING |
| Sponsor or PM authority (based on Charter) | PENDING |
| Decision and approval link | PENDING |
| Updated versions / owners notified | PENDING |

**Done gate:** PM validates WBS and dependencies against official tracker, reviewers approve the update rules, and BF-PM-01 / BF-PM-02 governing decisions are recorded. See issue #3.
