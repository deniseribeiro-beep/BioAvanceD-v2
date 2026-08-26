# HANDOFF

> **INTERIM — THIS SESSION IS STILL RUNNING.** Written after iteration 4 of
> a self-picked 5-item queue. **4 of 5 worked, 1 remains.** A progress
> snapshot, not the definitive rotation. If you are reading this cold, the
> session ended unexpectedly mid-queue — treat item 5 as untouched.

**Written:** 2026-08-26, first sitting of the day.

## ⚠ Two things are waiting on Dennis

1. **#796 is deliberately OPEN** — half shipped, half is a design fork
   (below).
2. **Item 5 (#794 items 2–3) needs a Docker decision.** It is frontend UI
   and **cannot be proven natively**; the stack is cold, so a gate means the
   full cold-start sequence. This is the one queue item that can't proceed on
   the session's native-only default.

## The queue

Dennis asked for the next 5 issues and left the pick to me. Theme: **make
the LGPD import quarantine usable, and close out the "field nothing writes"
cluster.**

| # | Item | Route | State |
|---|---|---|---|
| 1 | **#799** FHIR reader served LGPD quarantine batches | fix-bugs | **closed** `5d2e8cfc` / `ca8e01d3` |
| 2 | **#795** `Paciente ID: undefined` in the RF004 audit trail | fix-bugs | **closed** `377bb297` / `6d7cf459` |
| 3 | **#796** `persistConsentDeliveryFailure` no-op | fix-bugs | **partial** `b36d971c` / `e3b722f4`; **OPEN, awaiting Dennis** |
| 4 | **#792** import deleted the source file despite quarantine | build-loop | **closed** `dbf3b31b` / `eaaebe47`; throw case split to **#806** |
| **5** | **#794** items 2–3: quarantine UI + correct-and-resubmit | build-loop | **next — needs the Docker call** |

Classification for all five was done **once, up front**, per `issue-loop`'s
closed-list rule. Don't re-derive it per item.

**#792 was sequenced before #794 deliberately, and that dependency is now
discharged:** #794 item 3 (correct-and-resubmit) cannot work against a file
that has been deleted.

## What shipped, briefly

**#799** — `getBatch` discriminated on `_id` only, so every FHIR endpoint
resolved LGPD quarantine batches across a permission boundary. The body
missed that `validateBatch` is a **write** and that
`attachExternalDocument` never calls `getBatch` at all — the pre-fix run
reproduced it releasing an LGPD row to `COMMITTED`/`RELEASED`/`AVAILABLE`.

**#795** — three reads of `sample.patientID`, all `undefined`; the RF004
audit row read literally `Amostra criada - Paciente ID: undefined` for every
sample ever created.

**#796 (partial)** — every `RF_CONSENT_NOTIFICATION` compliance record was
written with no link to the participant. Fixed.

**#792** — new `retainSourceFileForBatch` moves the upload from
`uploads/temp/` to `uploads/quarantine/<batchId><ext>` and records
`sourceFile` on the batch. **Stored name is the batch id, never the uploaded
`originalname`** — that is client-controlled and would be a path-traversal
vector; there is a test passing `'../../../../etc/passwd.csv'`. Clean
imports still delete their file.

## #796 — the decision Dennis needs to make

`persistConsentDeliveryFailure` is confirmed a permanent no-op as filed. New
evidence the body didn't have: the three fields it writes are **absent from
`PatientModel`'s canonical allowlist** (`models/Patient.js:8`), and it reaches
Patient through a raw driver `updateOne` bypassing the model. So "just wire it
up" means writing non-canonical fields onto Patient — what PR 100 removed.
`docs/` has nothing mandating a delivery-failure record, so unlike #795 the
docs do **not** settle this. Three options are on the issue thread; I lean
toward recording it on the notification side (now queryable per participant),
then deleting. Did not guess.

## Filed this sitting

**Project:** **#801** (`attachExternalDocument` marks any record
`COMMITTED`/`RELEASED` with no validation-state check), **#802**
(`validateImportConsentToken`, the query #799 left undiscriminated),
**#803** (test mocks return shapes production never emits — **and its own
`tests/factories/sample.factory.js` emits `patientID`/`registerDate`/
`locationID`, three prohibited aliases the API 422s; corrected by comment**),
**#804** (`sampleID` still emitted though prohibited; populated, so renaming
breaks callers), **#805** — **the most severe find**: `buildConsentLink`
emails `/patients/undefined/consent?token=…`, token in a query string the
page never reads, across **all four bulk consent-invitation paths**,
**#806** (#792's throw case — needs a row-less batch, which contradicts
#787's "no empty batch" decision), **#807** (quarantined civil identifiers
stored in **plaintext** — both `import_staging_records.row` and now the
retained file — while #566 encrypts the same data at rest everywhere else).
Also commented a scope extension on **#793**: it now covers the retained
files as well as the staged rows, and they must expire together.

**Pack:** **#463** (routing gate blocks a queue-level `AskUserQuestion`),
**#464** (ending-sequence checkout dumps every touched file into context per
iteration; plus the `git pull --ff-only` multi-branch failure), **#465**
(`fix-bugs`' bundled-sub-points rule has only one ending — "close the
original" — which loses the thread when the *unresolved* half is the issue's
subject). Recurrence comments on **#401** and **#398**.

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**
  (`eaaebe47` + this rotation). No open PR; `main` frozen, 99 behind.
- All four fix/test branches deleted local **and** remote, no prompt any
  time (four more data points for pack #410's tally).
- **Correction to the pre-session handoff:** `test/787-lgpd-import-staging`
  is still present local and remote, fully merged. Safe to delete after the
  authorship check (precedent #332).
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- `fix/599-*` (both merged), `test/377-docs-on-main` and
  `test/human-showcase-video` (not merged) unchanged.
- **#752** red unchanged and pre-existing; not re-checked.

## Docker

**Still down, still cold — nothing started this sitting.**

- **Services:** none. **Bootstrap:** none. The four named volumes were
  dropped at the previous sitting's teardown and never recreated, so
  **nothing is seeded.**
- A gate needs the full sequence from scratch: 12-service recipe with
  `--build`, then `admin-bootstrap-test`, then the entire 17-service
  reference-data chain. Not optional.
- `backend-app-test`'s image carries #788/#790/#794-slice-1 from the previous
  sitting but **none of #799, #795, #796 or #792** — all four merges are
  host-side only. Build-not-mount: rebuild before any e2e run.
- **`build-loop`'s "Docker on by default per iteration" does NOT apply to
  backend-internal slices in this repo** — its own overlay
  (`build-loop/local-env/bioavanced-v2.md`) carves them out: "real backend"
  means the strongest native-only proof (a mock with real query-matching
  semantics), with literal Docker reserved for the milestone's e2e Playwright
  specs and `ship-integration-branch`. That is what #792 ran on. **Item 5 is
  a UI slice and does not get that carve-out.**

## Working rules confirmed this sitting

- **Read the routed skill's `local-env/` overlay before scoping, not after.**
  For #792 it settled the Docker question outright and named the branch-prefix
  constraint (`branch-guard.cjs` allows only `feature/docker-e2e-backend-integration`,
  `fix/<slug>`, `test/<slug>` — build-loop work uses `test/<slug>`).
- **Read `canonical-data-contract-v1.md` and `canonical-data-cleanup.md`
  before escalating any field-naming question.** #795's fork was settled
  there outright; #796's came back empty, which is what made it a real
  escalation. Run the check either way — the empty result is itself evidence.
- **Re-trace every issue body's file citations.** Four for four had errors
  or omissions this sitting.
- **Check the red run per-test, not in aggregate** — a not-yet-built
  capability's negative paths pass vacuously (pack #449). Both build-loop
  and fix-bugs iterations this sitting had exactly one legitimately-passing
  test in their red run.
- **Anything multi-line or with shell metacharacters goes to a file first.**
  `--body-file` always; `--body-file -` fed by a quoted heredoc works for
  shorter bodies.

## Recommended next steps

**Item 5 (#794 items 2–3) is next, but ask Dennis about Docker first** — it
is frontend UI and cannot be proven natively, and the stack is cold.

If Docker is declined, the honest options are to land item 2 (the UI) with
a temporary mocked-auth Playwright smoke check per the build-loop overlay's
pure-frontend-UI proof bar, or to defer #794 entirely.

**Then bring #796's fork to Dennis** if he has not answered.

Not in this queue, still the highest-severity item on the board: **#684**
(any authenticated user can revoke any patient's consent). **#800 and #801
are the same class** — one object-ownership decision unblocks all three.
