# HANDOFF

> **INTERIM — THIS SESSION IS STILL RUNNING.** Written after iteration 1 of
> a self-picked 5-item queue. **1 of 5 resolved, 4 remain.** This is a
> progress snapshot, not the definitive rotation for the sitting. If you are
> reading this cold, the session ended unexpectedly mid-queue — treat the
> remaining four items as untouched and re-verify before assuming anything
> about them.

**Written:** 2026-08-26, first sitting of the day.

## The queue

Dennis asked for the next 5 issues and left the pick to me. Theme: **make
the LGPD import quarantine usable, and close out the "field nothing writes"
cluster.** Docker was *not* authorised for this sitting and has not been
touched — see Docker below.

| # | Item | Route | State |
|---|---|---|---|
| **1** | **#799** FHIR reader serves LGPD quarantine batches | fix-bugs | **closed** `5d2e8cfc` / merged `ca8e01d3` |
| 2 | **#795** `Paciente ID: undefined` in the RF004 audit trail | fix-bugs | not started |
| 3 | **#796** `persistConsentDeliveryFailure` permanent no-op | fix-bugs | not started |
| 4 | **#792** import deletes the source file even when rows quarantined | build-loop | not started |
| 5 | **#794** items 2–3: quarantine UI + correct-and-resubmit | build-loop | not started |

**Ordering is load-bearing between 4 and 5:** #792 (retain the uploaded
file) is a hard dependency of #794 item 3 (correct-and-resubmit) — you
cannot resubmit a corrected row from a file that has been deleted. Do not
swap them.

Classification for all five was done **once, up front**, per `issue-loop`'s
closed-list rule. Don't re-derive it per item.

## Iteration 1 — #799

`getBatch` discriminated on nothing but `_id`, so every FHIR endpoint
resolved LGPD quarantine batches. The two paths are gated on different
permissions (`uploadFiles` vs `createPatient`/`createSample`), and
quarantined rows carry `row` — the pre-anonymisation spreadsheet line.

**The body's trace was right but understated the blast radius, twice:**

1. **`validateBatch` is a write.** It rewrote every record's status, then
   `refreshBatchCounts` overwrote the batch's own `QUARANTINED` status and
   replaced the file-level counts (rows in file / rows imported) with FHIR
   counts over the quarantined rows alone — destroying the record of what
   the operator submitted.
2. **`attachExternalDocument` never calls `getBatch` at all** and the body
   never mentions it. It queried `import_staging_records` directly, then
   marked the row `COMMITTED` / `RELEASED` / `AVAILABLE` and wrote to
   `samples` keyed on a `specimenId` an LGPD record does not carry. The
   pre-fix test run **reproduced this** — the LGPD row came back released.

Bounded by: `commitBatch` could *not* create patients from LGPD rows
(quarantined rows always carry errors → never `READY_TO_COMMIT`).

Fix is an allow-list (`type: 'FHIR_BUNDLE'`) via a shared `findFhirBatch`
helper, 404 not 403. **No migration hazard** — `stageBundle` has stamped the
type since the file's first commit (`13b96eb0`), checked explicitly for the
#762 shape.

**Proof:** new `fhir-import-staging.batchTypeIsolation.unit.test.js`, 8
tests. Red run was 7 failed / 1 passed, and the 1 pass is the FHIR
regression guard that must pass in both states — read per-test, not in
aggregate. Merged tree: **169/169 green** across 7 suites.

## Filed this sitting

**Project:** **#801** (`attachExternalDocument` marks any record
`COMMITTED`/`RELEASED` with no validation-state check, and ignores
`matchedCount: 0` on the sample write), **#802** (`validateImportConsentToken`
is the one query #799 left without the discriminator — inert today because
its batchId comes from an HMAC-signed token, filed so it isn't recorded only
on a closed thread).

**Pack:** **#463** (routing gate blocks a *queue-level* `AskUserQuestion` in
`issue-loop` queue mode; #382's housekeeping allowlist doesn't reach it, and
the closed-list rule makes it reproducible every time). Recurrence comments
on **#401** (heredoc parse failure — auto mode's use-Bash-for-edits rule
drives straight into it) and **#398** (Rule-0 junction guard blocks
read-only introspection via **PowerShell**, a surface those issues don't
name).

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`ca8e01d3`). No open PR; `main` frozen and 99 behind — untouched.
- `fix/799-fhir-batch-type-isolation` deleted local **and** remote. The
  remote delete succeeded with no prompt (another data point for pack #410's
  tally, which is still unresolved between #391 and #482).
- **Correction to the previous handoff:** it claimed "no `fix/` or `test/`
  branches outstanding." **`test/787-lgpd-import-staging` is still present,
  local and remote, and is fully merged into the integration branch.** That
  claim was true only of the three branches created *that* sitting. Safe to
  delete after the usual authorship check (precedent #332); left alone
  because it predates this session.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- Older local branches unchanged: `fix/599-ci-trigger-integration-branch`
  and `fix/599-hold-ci-trigger-for-milestone` are merged (safe to delete);
  `test/377-docs-on-main` and `test/human-showcase-video` are not merged.
- The known **#752** red is unchanged and pre-existing; not re-checked.

## Docker

**Still down, still cold — nothing was started this sitting.**

- **Services:** none running. Not started, not stopped.
- **Bootstrap:** none. The four named volumes were dropped at the *previous*
  sitting's teardown and have not been recreated, so **nothing is seeded**.
- A next e2e gate therefore still needs the full sequence from scratch: the
  12-service recipe with `--build`, then `admin-bootstrap-test`, then the
  entire 17-service reference-data chain. The chain is not optional.
- `backend-app-test`'s image still carries #788/#790/#794 from the previous
  sitting, **but not #799** — this sitting's merge is host-side only.
  Build-not-mount: any `api/backend/src` change needs a rebuild before an
  e2e run, or a stale image serves old code with no error.
- **Docker was deliberately not authorised for this queue.** Verification
  ran on the documented default — native only, gate end-loaded per
  `ship-integration-branch`. **Item 5 (#794 items 2–3) is frontend UI and
  cannot be proven natively**; raise the Docker decision with Dennis when
  that item comes up, per `docker-workflow`'s per-iteration exception.

## Working rules confirmed this sitting

- **Anything multi-line or carrying shell metacharacters goes to a file
  first, never inline into a Bash argument.** Hit twice: a 190-line quoted
  heredoc failed at parse time, and `gh issue comment --body "..."` failed
  on an escaped backtick. `--body-file` and the Write tool both worked
  first try. Broader than pack #419/#433's backslash framing.
- **The routing gate re-arms on the closed-list body read.** `issue-loop`
  queue mode tells you to read all N issue bodies up front; that read lands
  *after* the `issue-loop` call, so the next `AskUserQuestion` blocks. Route
  the next item first, then ask. Filed as pack #463.
- **Check the red run per-test, not in aggregate** — the FHIR regression
  guard was *supposed* to pass in the red run; "8 tests, 1 passed" would
  have looked like a partial reproduction if read as a total.

## Recommended next steps

**Continue the queue at item 2 (#795).** Do not re-pick or re-plan — the
five were chosen and classified together, and #792 must precede #794.

Not in this queue, still the highest-severity item on the board: **#684**
(any authenticated user can revoke any patient's consent). Blocked on the
RF010/RF021 actor model, which is a product call for Denise. **#800 and the
new #801 are the same class** — one decision about object-ownership scoping
would unblock all three.
