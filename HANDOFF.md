# HANDOFF

**Written 2026-09-08, twenty-fourth queue sitting. INTERIM — no end signal
was given, so treat the session as CONTINUING.** Dennis asked to read the
handoff and pick the next *group* of issues, and said Docker was on. I took
the previous note's recommended list — **#1107, #1104, #1105** — and shipped
four commits.

**The gates have NOT finished.** The full native suite was running at the time
of writing and the Docker e2e gate had not started. Do not read this note as a
green gate; re-run both.

## What shipped

Branch `feature/docker-e2e-backend-integration`, tree clean and matching
origin. `main` untouched and still frozen.

| commit | issue | what |
|---|---|---|
| `710d98e0` | **#1107** closed | `POST /api/logs/register` removed — the audit-trail forgery surface — with three dead frontend symbols |
| `3f8b0ece` | Refs **#1104** | three `participantIdentities` readers that bypassed `decryptIdentity` now decrypt |
| `f0ff09e8` | Refs **#1104** | `checkIdentifierConflict` + `searchPatients` get blind-index `$or` arms |
| `5a751fc5` | **#1105** closed | validated caller-declared `source` on `auditLogger` |

## The one thing a next session must not undo

**`5a751fc5`'s source validation must stay.** `auditLogger.log({source})` is
resolved against a frozen six-value vocabulary and anything else falls back to
`'api'`. The tempting cleanup is to trust the caller and drop the check.
Don't: `integrityCheckService.js:60`'s `buildHashPayload` includes `source` and
rows are `immutable`, so an unvalidated typo is sealed into the daily Merkle
root — which is #1094's defect arriving through a different door. A test pins
`source: 'wokrer'` → `'api'`.

- **`backup-policy.service.js` is deliberately NOT a `'scheduler'` site.**
  `[read it]` it is request-driven — the `log()` call is inside
  `updatePolicy(db, …, req)`, passes `req`, and its only caller is
  `backupPolicy.routes.js:37`'s PUT handler. #1105's body listed it; that was
  wrong and the issue carries the correction. Declaring `'scheduler'` there
  would make a correct row wrong.
- **`f0ff09e8`'s `checkIdentifierConflict` hash arm does not actually match a
  punctuated document, and that is #1109, not a bug in the commit.** The arm
  faithfully reproduces the pre-existing plaintext arm, which had the same
  mismatch. Don't "fix" it by removing the arm.

## #1104 is open on purpose, and its premise was wrong twice

Its stated precondition — *"every consumer is already repointed"* — is false.
`[ran it]` there are **seven** matching sites, not the "both" the body assumes,
and **nine** readers, three of which bypassed `decryptIdentity`. Slices A and B
fixed six of the seven and all three readers. What remains:

- **`patientName` — a real design fork.** `patient.service.js#listPatients`
  does `find({ patientName: { $regex: term, $options: 'i' } })`; a blind index
  is exact-match by construction and cannot serve a substring search. `[ran
  it]` live and reachable via `paciente.controller.js:239`. `[ran it]` the docs
  do not settle it — RNF007 AC#2 says *"sob controles reforçados"*, dict-07 row
  1 says *"cifrar"*, no RF/RNF mentions searching by name, and no milestone
  sequences it. Dennis was asked and handed the call back.
- **`identityDocument` — blocked on #1109.**
- **`birthDate` has no blocker left** — its normalization agrees on both sides
  and all four of its query sites now carry hash arms. It is the one field that
  could be cut over as-is.

**Three separate looks turned up three separate unrecorded blockers.** Treat
any claim that this cutover is ready as unverified until re-enumerated.

## Issue state

Query it — `gh issue list --state open`. What a query cannot carry:

- **Closed this sitting: #1107, #1105** (the latter `premise-corrected`).
  **Filed: #1108, #1109, #1110**, plus dyeallpies-skills-pack **#835, #836,
  #837**, and pack **#824 reopened** on a measured recurrence.
- **#1109 is the sharpest of the three filed.** `[ran it]`
  `checkIdentifierConflict` strips non-digits from the document it searches
  for while every writer stores it verbatim, so for a punctuated CPF **both**
  arms miss and a second participant is created for the same civil identity.
  It fails open besides. Proven end to end through the real write and query
  paths, not inferred.
- **#1110 has an unusually clear docs answer** — RF012 AC#10 forbids
  IA/Assistente in the current scope outright and RF-FUT-001 carries a
  *Regra de exclusão*. Its one open question is whether `Log.js`/
  `audit.middleware.js`'s `'Assistant'`/`'IntelligentAssistant'` entries are
  declared in dict-02; check that first.
- The four pack issues can only be worked from a `dyeallpies_skills_pack`
  session — Rule 0, enforced by `junction-write-guard`.

## Gates

- **`npm run test:architecture` 124/124** after every iteration, three times.
- **Per-iteration consumer sweeps, all green:** #1107 28 files / 699;
  #1104 104 / 1932 then 104 / 1935; #1105 137 / 2691.
- **Can-it-fail probes on every slice, executed count checked against the
  green baseline both runs (#804):** #1107 4 red / 54; #1104 3 red / 75 then
  5 red / 79; #1105 8 red / 131.
- **Full native suite: NOT COMPLETE at rotation.** Sanctioned form is
  `npx vitest run tests/unit tests/integration tests/compliance --reporter=dot`
  from `api/backend`, backgrounded — the bare form is blocked by
  `full-suite-guard` and the run exceeds the 600s foreground ceiling.
- **Docker e2e gate: NOT RUN.** `--build` is mandatory — four commits touched
  `api/backend/src` and `backend-app-test` is build-not-mount. `[ran it]`
  engine 28.5.1 up; `compose.test.yml` currently declares **34 services**, of
  which **17** are the bootstrap chain (`foundation-bootstrap-test` plus 16
  `reference-data-bootstrap-*`). Recipe as the `docker-workflow` overlay
  documents it, `--workers=1`.

**Stack state: DOWN.** No containers were started this sitting; only
`docker version` and `docker compose config --services` were run, neither of
which starts anything. **Bootstrap: NONE has run against the current volumes.**

## The judgment a query cannot carry

- **Do not run a second heavy workload while the native suite is
  backgrounded.** `[read it]` pack #828 measured the previous sitting losing a
  ~466-file run to CPU contention from concurrent targeted `vitest` calls; the
  uncontended re-run took 589s, 367s of it `import`. Tracker writes and reading
  code are fine; a second suite or a Docker build is not.
- **`[ran it]` MSYS `grep` strips CR in text mode, so `grep -q $'\r'` reports
  LF on a CRLF file** — confidently, exit 0. Five files were misread that way
  this sitting. Use `grep -qU`, `file`, or `od -c`; the per-file detection
  inside a patch script is the authority and it caught it. Pack #836.
  `import-worker.test.js` is LF while its siblings are CRLF, so this is per
  file, not per repo.
- **`[ran it]` `git ls-files` emits repo-root-relative paths while the
  mandated consumer sweep runs from `api/backend`** — 28 named files, **zero
  executed**, exit 1. Pipe through `sed 's|^api/backend/||'`. Only #804's
  executed-count check caught it; `full-suite-guard` passed it and the exit
  code reads like ordinary failures. Pack #835.
- **A completeness claim in a commit message is a claim, and `github-issues`
  case 4 orders the class-wide re-run AFTER the write-up.** `3f8b0ece` says
  "the last three readers"; re-running the search found two more, in the file
  it had just edited. Re-run first, write second. Pack #837.
- **A line-anchored regex is why they were missed.** `^\s*(field):` cannot
  match `findOne({ field: value })`, which is the commonest spelling of the
  thing being hunted — a confident near-complete set, which is worse than a
  confident zero because it looks like a finding.

## Recommended next

Dennis named a group and the group is finished apart from #1104's held-back
cutover; **nothing further is queued by name.** In rough order of value:

1. **Finish the gates** — the native suite and the Docker e2e gate, in that
   order, one at a time. Nothing else should land until they are green.
2. **#1109** — the live duplicate-participant bug, and the thing blocking
   #1104's `identityDocument` half. Its direction 2 is contained to the
   hashing helper.
3. **#1104's `birthDate`-only cutover** — unblocked, and it makes half of
   #1102's hash indexes start paying.
4. **#1110** — clear docs answer; do the dict-02 check first.
5. **#1108** — the largest of the three filed, and the one most likely to
   need Denise rather than Dennis.
