# HANDOFF

**Written 2026-09-07, eighteenth queue sitting. INTERIM — no end signal was
given, so treat the session as CONTINUING.** Dennis asked to read the handoff,
pick the next group of issues, and said Docker was on. I took the #1053
org-scope family — **#1082, #1087, #1088** — then worked one of my own
findings to close. Six commits, **three issues closed**, four filed.

**BOTH GATES RAN. That is the headline, and it reverses the previous note.**
The last sitting's "NEITHER GATE RAN" is discharged: everything that was
unverified then is verified now.

## Gate results

Native, all at the final tree, all exit 0:

- **Backend vitest 463 files / 8663 tests** (`tests/unit tests/integration
  tests/compliance`). The +12 over the previous 8651 is exactly this
  sitting's new cases.
- **`npm run test:architecture` 124/124** (was 122; #1088 added two).
- **Frontend 32 files / 262 tests**, `typecheck` (both halves), `lint` 469
  files.

**Docker e2e gate: 205 passed / 18 failed.** Full `compose.test.yml` stack,
`backend-app-test` rebuilt (`--build`; it is build-not-mount and the image
timestamp was confirmed newer than the last backend commit), 17-service
reference-data chain all `Exited (0)`, `playwright-runner` stopped,
`--workers=1`.

**All 18 failures are pre-existing and none is from this sitting's commits.**
`[ran it]` `git merge-base --is-ancestor` puts all three root causes before
`01791b44`. One is now fixed; 17 are **#1091**.

## The correction that matters most

**The previous note's "the last green gate at `01791b44`" is FALSE for the
e2e half, and the next session must not use it as a baseline.** `[ran it]`
`f5c671c7` and `956f3b85` (#1054's machine-credential gate, 2026-09-04) are
both ancestors of `01791b44`, and they make 17 `interop-monitoring.spec.ts`
tests 403 by construction — `compose.test.yml` sets no
`TELEMETRY_INGEST_SECRET` and no spec sends the header. The e2e suite cannot
have been green at that commit. Filed as **#1091** with both halves of the
fix. `[ran it]` CI has no e2e job at all (no `playwright`/`test:e2e` in
either workflow file), so only the local gate can ever catch this class.

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching origin.
  `main` untouched, no PR. `git status -sb` is authoritative.
- **Six commits.** Last substantive is the #1090 specimenId-tier fix, which
  landed AFTER the gate run below — it is covered by native runs only.
- **No new files, no new env keys, no new npm scripts, no dependency or
  compose changes.**
- **Nothing left running.** Stack torn down with `down --remove-orphans`;
  `docker ps -a` empty. Named volumes kept (they are meant to persist).

## Issue state

Query it — `gh issue list --state open`. What a query cannot carry:

- **#1082, #1088 and #1090 closed.** #1087 had its org-scope half shipped
  and is **deliberately open** on its real question.
- **#1087's open half is a capability decision for Denise**, not a defect:
  may a Técnico and an external user read the equipment inventory? Gating the
  two list routes on `manageStorageTopology` breaks Técnico and
  UsuarioExterno across three views, two of them `ALL_ROLES`, and it fails
  *silently* because `useEquipment` swallows the error into an empty list.
  Do not "finish" #1087 without that answer.

## The judgment a query cannot carry

- **#1088's direction 1, implemented exactly as the issue specified, is
  VACUOUS on its own.** `[ran it]` population 511 before and after — all nine
  measured sites pass non-literal arguments, so a literal-only detector
  matches none of them. It shipped anyway (the idiom is what #1053's children
  are adding) plus a second half that enumerates the shapes actually present.
  **The can-it-fail probe passed cleanly while the detector was inert** —
  filed against the pack as dyeallpies-skills-pack#797.
- **Reading the three helpers #1088's new list marks `UNCHECKED` immediately
  found a real one: #1090.** `normalizeSampleIdFilter` returns
  `{ sampleID: ... }` — a `RETIRED_FILTER_KEYS` member — unexempted and
  invisible. It also skips the canonical `specimenId` tier entirely, unlike
  the three exempted siblings.
- **#1092 records a consequence of #1082, not a defect in it:** an `amostras`
  row with no `collectionSite` is now unwritable through all three
  destination-checked result routes for every non-Administrador. Correct
  fail-closed behaviour; **`[not established]`** whether legacy rows lack the
  field, which is the whole question.
- **"This tree is CRLF" is per-file, not repo-wide.** `[ran it]`
  `result.routes.js` and both integration test files are **LF** — the
  previous note's CRLF tape did not apply. Detect per file; don't assume
  either way.
- **Bounding every replacement paid twice again.** `const fileType =
  getResultFileType(file.originalname);` matches **2** (multer's own
  `fileFilter` carries the identical line), and `results:
  createCollectionMock()` matches **9**. Both caught before anything was
  written.
- **A can-it-fail probe leaves residue that reds a later run.** The #1082
  probe's ungated upload really does write a file, the failing assertion
  skips the trailing `rmSync`, and the next full-file run inherits it. A test
  asserting on `storage/` contents must clear the directory *before* the
  request, not only after.
- **Two line-keyed arch guards shifted, and they behave differently.**
  `filter-keys` has no companion "still found" assertion, so a stale entry is
  harmless there and the red arrives via the main test;
  `request-body-boundary` *does* have one and fails loudly. Both renumbered.

## Recommended next

**Dennis named no successor**, so nothing is queued by him. In dependency
order, from what this sitting established:

1. **#1091** — it is the only reason the e2e gate is not green, it is fully
   diagnosed with both halves of the fix named, and until it lands every
   future gate run costs an investigation to re-clear the same 17.
2. **#1092** — its premise widened after filing: `Sample.js:61` declares
   `collectionSite` with `default: null` and no `required`, so new rows can
   lack it too, not just legacy ones. One query against a populated database
   answers it; it either closes or becomes a backfill plus a model change.
3. **#1086 then #1072**, in that order and not the reverse — unchanged from
   the previous note, still untouched.

**#1090 is done** (`dcf8d2c3`), and it is the evidence #1088's second half
earns its keep: its enumeration is what surfaced the helper, and tracing the
five callers found `sampleComplianceSync.service.js:26` passing a canonical
`specimenId` into a filter on the retired `sampleID` key.
