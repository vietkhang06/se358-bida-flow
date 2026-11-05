# BF-PM-02 — Verifiable UC01–UC47 reconciliation protocol

**Current status: provisional 47 identifiers only.** The repository's `docs/USE_CASE_COVERAGE.md` provides grouped labels, not the signed SRS. `PM_UC_SOURCE_RECONCILIATION.csv` is a ready-to-fill audit table, **not** evidence that all UC titles and owners were verified.

## Reviewer procedure

1. Retrieve signed/versioned SRS and the authoritative issue/WBS tracker. Note revision/hash, date and links in the CSV.
2. For each source UC, copy the **exact** UC ID, title, actor(s), SRS section, acceptance reference. Do not rename to fit the code.
3. Join on UC ID against tracker: confirm a responsible person, task/WBS, estimate, and reviewer. Mark missing, duplicate, out-of-scope and renamed rows explicitly. Add or remove provisional rows only with approved SRS evidence.
4. Link backend action(s) and UI location *after* requirement mapping is established. Presence of an API handler is not proof the UC's acceptance criteria are fulfilled.
5. For UC46 and UC47, the existing draft associates both collectively with the control-system area; it does not prove which one means audit or sign-out. Record separate source quotations and assign each using the approved tracker and role ownership decision.
6. A second team member reviews **all** rows and signs the reconciliation in a PR or decision-log entry with exact revision reference.

## UC47 decision fields

| Field | Current |
|---|---|
| Exact UC47 title and actor in signed SRS | PENDING |
| SRS revision/page | PENDING |
| Responsibility/owner | PENDING — **do not infer from UI or Git authorship** |
| Task/WBS and acceptance references | PENDING |
| Independent reviewer and approval link | PENDING |

**Done gate:** no `UNVERIFIED`, `UNASSIGNED_PENDING_TRACKER`, or unresolved discrepancies in the authoritative matrix; reviewer sign-off. See GitHub issue #2.
