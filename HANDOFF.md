# HANDOFF

**Written 2026-09-03, ninth queue sitting. Dennis asked for "5-10 issues,
Docker is on", then ended the sitting early on session limits.** Three
issues closed outright, two advanced and left open. 5 commits pushed. 6
issues filed here, 2 on the pack.

**The Docker gate did NOT run.** No stack was ever brought up this sitting.

Re-derive every count rather than trusting it.

---

## Repo state

- Branch `feature/docker-e2e-backend-integration`, clean and matching
  origin. `main` untouched, no PR.
- Last substantive commit: `cbfb74f5` (#1012 item 2).
- **New npm scripts / dependencies / env keys: none.**
- New test files: `frontend/src/views/ResultsPage.test.tsx` — the repo's
  **second** page-render RTL test, after `ImportLGPDPage.test.tsx`.

## Docker state — nothing ran, nothing is running

- **No stack was started at any point.** `docker ps -a` empty at the start
  of the sitting and at the end; `docker compose ls -a` empty.
- **The end-of-loop Docker gate is outstanding**, and so is any e2e run.
- Cleanup was requested and performed: `docker image prune -f` and
  `docker builder prune -f` both reclaimed **0B** — the previous sitting
  had already pruned. Remaining is all pre-existing and deliberately kept:
  **33 images / 4.683GB**, **49 local volumes / 1.536GB**, build cache 0B.
  A machine-wide `prune -a`, and removal of the `bioavanced-test-*` named
  volumes, still need Dennis's consent — the volumes hold the inherited
  bootstrap state.
- Bootstrap state: **present, inherited, not re-verified** — nothing was
  started against it.

## Verification actually performed

**Targeted native runs only. No full backend or frontend suite ran this
sitting, and `npm run test:architecture` did not run either.** Both are
outstanding before a PR, alongside the Docker gate.

| Slice | Run |
|---|---|
| #1007 | 11 backend files / 418 tests, 3 frontend files / 31 tests |
| #1003 | 10 files / 285 tests |
| #1009 | 7 files / 200 tests |
| #997 slice 2 | 4 frontend files / 34 tests |
| #1012 item 2 | 6 files / 267 tests |

Every consumer set was derived by two-hop grep from the changed symbol,
not from the files the fix touched.

## What closed (3)

`#1007` `#1003` `#1009`.

## What advanced and stayed open (2)

- **#997** — slice 2 (async RTL) shipped in `ce1fe705`. Remaining: the
  sync half, an assertion that a real HTTP import response carries
  `data.skipped`. **Docker-gated.** Its home is
  `tests/e2e/lgpd-sample-import.spec.ts`, which is `APIRequestContext`-only
  — so this needs Playwright-as-HTTP-client, **not** a browser spec. The
  issue's own suggested one-line fixture change would produce a misleading
  green; see the comment.
- **#1012** — item 2 refuted and the record corrected in `cbfb74f5`. Item 1
  (delete the three dead `isEmptyRow` backstops) is open and is a real
  judgment about defence-in-depth in Denise's importer.

Query the board for everything else (`gh issue list --state open`).

## The judgment a query cannot carry

- **[ran it] `csv-parser` 3.2.0 has no `skipEmptyLines` option, and never
  did.** Its `defaults` object doesn't list it and `grep -rn` over the
  package returns nothing; the constructor does `Object.assign({},
  defaults, opts)`, so it and `skipLinesWithError` are silently absorbed.
  **Three shipped artefacts assert otherwise** — #1001's close comment,
  `734a21c8`'s message, and (until `cbfb74f5`) the comment in `readCSV`.
  The general lesson: *"we configured the parser to do X"* is unfalsifiable
  without reading the dependency's own `defaults`.
- **[ran it] `auditLoggerMock` in `users-access.routes.test.js` never
  intercepts, and vitest does not warn.** `user.routes.js` requires
  auditLogger **lazily inside the handler** (`:98`, `:614`) rather than at
  module scope like `authService` (`:3`). Pointing the mock at a
  deliberately nonexistent module produces an **identical run** — same
  pass/fail counts, no error. So a mis-pathed mock and an unintercepted one
  are indistinguishable. This cost #1009 an assertion it should have been
  able to make. **#1017.**
- **[read it] #1009's stated "trap" does not exist.** It feared tightening
  the guard would stop org-only re-scoping, citing #615's test at
  `users-access.routes.test.js:640` — but that test sends a genuine
  2 → 3 level change. The org-only case has its own test (`:698`) and its
  own path (`updateAssignmentScope`, `user.routes.js:581`), which never
  consulted the guard. `rbac-assignment.service.js:320-329` says outright
  it is "deliberately not built on changeUserRole".
- **[read it] #1003's fix needed TWO hunks, not the one its body proposes.**
  Hunk A alone ships a #990 twin — a rollback would leave an open
  assignment. Unlike #990 the compensation is mechanically available:
  `storageAssignments` has no append-only guard, while
  `sampleMovementLedger` blocks `updateOne`/`deleteOne`. Hunk B is
  knowingly throwaway; #988 part 3 deletes `rollbackAutoAssignedPosition`.
- **[ran it] `storageService.releaseSampleFromPosition` has no production
  caller**, so `NO_STORAGE_LOCATION` is a documented error code no route
  can emit. **#1016.**
- **[read it] `backfillUserRoleAssignments`' `if (!user.accessType)
  continue` is NOT simply broken by #427** — pre-#427 users still carry the
  field in Mongo and are repaired correctly. The defect is that it is blind
  to the only *modern* orphan path, and skips silently. Framing it the
  obvious way would get it closed as a non-issue. **#1018.**
- **[ran it] This repo has MIXED line endings within single directories.**
  `import-worker.js` is CRLF while `import-worker.test.js` beside it is
  pure LF, with `core.autocrlf=true`. A multi-line exact-match edit must
  detect the EOL **per file** (`s.includes('\r\n')` in Node) — both
  "assume CRLF" and "assume LF" miss, silently, matching 0 times. And
  `od`/`hexdump` on a **pipeline** lies: MSYS `sed` strips the CR before
  you see it. Pack **#704**.

## Filed this sitting

Here: **#1014 #1015 #1016 #1017 #1018 #1019**.
On the pack: **#704** (line endings), **#705** (session limits / agent spend).
Comments added to **#988**, **#997**, **#1012**, and pack **#589**.

**Worth reading first: #1014** (after #1007, the Results page's Ignorados
and Duplicados tiles can now never render for any job it can display — a
product decision, not a bug), then **#1017** (the inert audit mock, because
it silently defeats assertions).

## Conventions this sitting relied on / established

- **Detect line endings per file, in Node, before any multi-line
  exact-match edit.** See the judgment section; this cost one wasted edit
  cycle plus a misleading `od` result.
- **Brief every worker to verify the precedent and report if it differs.**
  Three of six research agents contradicted a premise in the issue they
  were briefed on, and all three were right. This is the single
  highest-value clause in a brief.
- **The can-it-fail probe reverts every site and the count must be
  N-shaped** — held for all five slices, and each was re-run by the
  orchestrator rather than trusted from the worker's report.
- **A control case whose behaviour is identical before and after the fix
  must be GREEN pre-fix.** Used on every slice; it is what separates a real
  reproduction from a setup-shaped red, and it caught nothing this
  sitting — which is the point.
- **RBAC and permission-gate issues stay on the orchestrator's track.**
  `agent-delegation`'s triage excludes security-relevant work from write
  briefs; #1009 and #1010 both qualify.
- **Write `HANDOFF.md` and any long issue body with the `Write` tool**, not
  a heredoc — the harness truncates a Bash call over ~8,100 assembled
  bytes, and single quotes cost 5 bytes each.

## Recommended next

**None queued** — Dennis ended the sitting on session limits and named no
follow-on task.

The cheapest high-value work is **#1010** (the `disable-mfa` route has no
`requirePermission` gate; fully scoped, and note the trap — a
`PERMISSION_CATALOG` entry alone produces no `Permission` document and
would 403 everyone, so the code must also land in the `Administrador`
permissions array). **#974** looks closeable: its body premise is dead —
`Session.js` has both `revokedBy` and `revocationReason` at HEAD and an
admin revoke is not byte-identical to an expiry — but re-verify before
closing, and note the residual that `user-security.service.js:559` still
omits `updatedAt`.

**Before any PR:** the full native suites, `npm run test:architecture`, and
the Docker gate — none of which ran this sitting.
