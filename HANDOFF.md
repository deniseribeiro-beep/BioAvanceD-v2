# HANDOFF

> **INTERIM — THIS SESSION IS STILL RUNNING.** Written after iteration 2 of
> a self-picked 5-item queue. **2 of 5 resolved, 3 remain.** A progress
> snapshot, not the definitive rotation. If you are reading this cold, the
> session ended unexpectedly mid-queue — treat the remaining three items as
> untouched and re-verify before assuming anything about them.

**Written:** 2026-08-26, first sitting of the day.

## The queue

Dennis asked for the next 5 issues and left the pick to me. Theme: **make
the LGPD import quarantine usable, and close out the "field nothing writes"
cluster.** Docker was *not* authorised and has not been touched.

| # | Item | Route | State |
|---|---|---|---|
| 1 | **#799** FHIR reader serves LGPD quarantine batches | fix-bugs | **closed** `5d2e8cfc` / merged `ca8e01d3` |
| 2 | **#795** `Paciente ID: undefined` in the RF004 audit trail | fix-bugs | **closed** `377bb297` / merged `6d7cf459` |
| **3** | **#796** `persistConsentDeliveryFailure` permanent no-op | fix-bugs | **next, not started** |
| 4 | **#792** import deletes the source file even when rows quarantined | build-loop | not started |
| 5 | **#794** items 2–3: quarantine UI + correct-and-resubmit | build-loop | not started |

**Ordering is load-bearing between 4 and 5:** #792 (retain the uploaded
file) is a hard dependency of #794 item 3 (correct-and-resubmit) — you
cannot resubmit a corrected row from a file that has been deleted. Do not
swap them.

Classification for all five was done **once, up front**, per `issue-loop`'s
closed-list rule. Don't re-derive it per item.

**#796 carries an owner's-call flag in its own body** ("wire the fields to
`participantId`, or delete them as cruft — the owner's call, hence this
issue rather than a fix"). Per #795's precedent below, **check the RF/dict-02
docs before escalating** — the last two bodies that looked like design
questions were both settled by `docs/architecture/`.

## Iteration 1 — #799

`getBatch` discriminated on `_id` only, so every FHIR endpoint resolved LGPD
quarantine batches across a permission boundary (`uploadFiles` vs
`createPatient`/`createSample`); quarantined rows carry `row`, the
pre-anonymisation spreadsheet line.

The body understated the blast radius twice: **`validateBatch` is a write**
(it overwrote the batch's `QUARANTINED` status and replaced file-level counts
with FHIR counts over the quarantined rows alone), and
**`attachExternalDocument` never calls `getBatch` at all** and went unmentioned
— the pre-fix test run reproduced it releasing an LGPD row to
`COMMITTED`/`RELEASED`/`AVAILABLE`. Fixed with an allow-list
(`type: 'FHIR_BUNDLE'`) via a shared `findFhirBatch` helper, 404 not 403. No
migration hazard — the type has been stamped since the file's first commit.

## Iteration 2 — #795

Three reads of `sample.patientID` on the create path, all `undefined`. The
RF004 audit row was written literally as `Amostra criada - Paciente ID:
undefined` for **every sample ever created**, and the audit payload key
serialised away entirely. No live recomputation to fall back on, unlike
#788's badge.

**Two things worth carrying forward:**

1. **The body's file citation was wrong.** It named
   `core/use-cases/RegisterSample.js`; the route actually uses
   `RegisterSampleUseCase.js` → inline `sampleRepository.create` →
   `sampleService.createSample`. Two parallel files, body picked the unwired
   one. Conclusion still correct after re-tracing from the route.
2. **The attached "naming question" was already answered by the repo's own
   docs.** `docs/architecture/canonical-data-contract-v1.md` has a **"Legacy
   Fields Prohibited"** list carrying `patientID`, `patientId`, `sampleID`,
   `sampleId`, `registerDate` and more; `canonical-data-cleanup.md` PR 100
   records the decision as *"reject non-canonical participant payloads with
   422 instead of converting them."* **Read those two files before treating
   any vocabulary question in this repo as an owner's call.**

The rename was safe because the value was `undefined` — `JSON.stringify` had
always dropped the key, so no caller could be reading it (verified against
`frontend/src` and `e2e`).

## Filed this sitting

**Project:** **#801** (`attachExternalDocument` marks any record
`COMMITTED`/`RELEASED` with no validation-state check, and ignores
`matchedCount: 0`), **#802** (`validateImportConsentToken` — the one query
#799 left undiscriminated; inert today, token is HMAC-signed), **#803**
(test mocks return shapes production never emits — **25 candidate sites**;
this is what kept #795 *and* #788 green, and is the output-side mirror of
#797's input-side filter blindness), **#804** (`sampleID` is still emitted
though prohibited — unlike #795's key it is populated, so renaming it
genuinely breaks callers).

**Pack:** **#463** (routing gate blocks a queue-level `AskUserQuestion` in
`issue-loop` queue mode), **#464** (the ending sequence's checkout dumps
every touched file's full pre-merge contents into context, once per
iteration — plus a comment on the `git pull --ff-only` "Cannot fast-forward
to multiple branches" failure in the same step). Recurrence comments on
**#401** (heredoc) and **#398** (junction guard blocks read-only PowerShell).

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`6d7cf459` + this rotation). No open PR; `main` frozen and 99 behind.
- Both fix branches deleted local **and** remote, no prompt either time
  (two more data points for pack #410's tally).
- **Correction to the previous handoff:** `test/787-lgpd-import-staging` is
  still present local and remote, fully merged. The earlier claim of "no
  outstanding `test/` branches" was true only of the branches created that
  sitting. Safe to delete after the authorship check (precedent #332).
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- `fix/599-*` (both, merged), `test/377-docs-on-main` and
  `test/human-showcase-video` (not merged) unchanged.
- The known **#752** red is unchanged and pre-existing; not re-checked.

## Docker

**Still down, still cold — nothing started this sitting.**

- **Services:** none running. **Bootstrap:** none. The four named volumes
  were dropped at the *previous* sitting's teardown and never recreated, so
  **nothing is seeded.**
- A next e2e gate needs the full sequence from scratch: 12-service recipe
  with `--build`, then `admin-bootstrap-test`, then the entire 17-service
  reference-data chain. Not optional.
- `backend-app-test`'s image carries #788/#790/#794 from the previous
  sitting but **not #799 or #795** — both merges are host-side only.
  Build-not-mount: rebuild before any e2e run or a stale image serves old
  code silently.
- Verification ran on the documented default — native only, gate end-loaded
  per `ship-integration-branch`. **Item 5 (#794 items 2–3) is frontend UI
  and cannot be proven natively**; raise the Docker decision with Dennis
  when that item comes up.

## Working rules confirmed this sitting

- **Read `docs/architecture/canonical-data-contract-v1.md` and
  `canonical-data-cleanup.md` before escalating any field-naming question.**
  Both of this sitting's apparent design forks were settled there.
- **Anything multi-line or carrying shell metacharacters goes to a file
  first, never inline into a Bash argument.** A 190-line quoted heredoc
  failed at parse time; `gh issue comment --body "..."` failed on an escaped
  backtick. `--body-file` works, and `--body-file -` fed by a quoted heredoc
  also works for shorter bodies.
- **The routing gate re-arms on the closed-list body read** — route the next
  queue item before asking anything. Pack #463.
- **Check the red run per-test, not in aggregate.** #799's FHIR regression
  guard was *supposed* to pass in the red run; read as a total, "1 passed"
  would have looked like a partial reproduction.
- **Re-trace every issue body's file citations.** Two of two bodies worked
  this sitting had errors — #799 understated severity and missed a write
  path, #795 named a file not in the call path.

## Recommended next steps

**Continue the queue at item 3 (#796).** Do not re-pick or re-plan — the
five were chosen and classified together, and #792 must precede #794.

Not in this queue, still the highest-severity item on the board: **#684**
(any authenticated user can revoke any patient's consent). Blocked on the
RF010/RF021 actor model, a product call for Denise. **#800 and #801 are the
same class** — one decision about object-ownership scoping unblocks all
three.
