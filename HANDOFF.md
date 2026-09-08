# HANDOFF

**Written 2026-09-08, twenty-sixth queue sitting. INTERIM — no end signal was
given, so treat the session as CONTINUING.** Dennis asked to read the handoff,
pick the next *group* of issues, and said Docker was on. I took the previous
note's recommended list — **#1111, #1114, #1113** — and **all three are
done**. The end-loaded gates are **mid-flight**, not finished; see below.

## What shipped

Branch `feature/docker-e2e-backend-integration`, tree clean and matching
origin. `main` untouched and still frozen.

| commit | issue | what |
|---|---|---|
| `3a0f3e04` | **#1113** closed | `matchOrUpsertParticipant` reads its identity fallbacks off the mirror, decrypted, and omits absent fields instead of nulling stored ones |
| `610804c0` | **#1111** closed | the parity gate compares only the fields the Patient still carries, so `isFullParity` is reachable again — plus an emptiness check so it cannot open vacuously |
| `713168b2` | **#1114** closed | `Log.js`'s inert `VALID_ENTITIES` removed; labelled `premise-corrected` |

**Filed: #1115.** Query the tracker for state — `gh issue list --state open`.

## GATES ARE NOT FINISHED — this is the first thing to check

- **`npm run test:architecture` 124/124** (matches the previous note's
  baseline).
- **Consumer sweeps, all green:** #1113 26 files / 538 tests; #1111 9 / 91;
  #1114 36 / 735 **plus** `canonical-catalog-conformance.arch.test.js` 4/4
  via `node --test`.
- **Full backend regression: STARTED, RESULT UNKNOWN.** Launched as
  `npx vitest run tests/unit tests/integration tests/compliance
  --reporter=dot` from `api/backend`, backgrounded, redirected to the
  session scratchpad. It had not printed a summary when this note was
  written. **Re-run it; do not assume it passed.** Last known green is
  466 files / 8783 tests and that predates all six commits on this branch
  since the previous note.
- **Frontend suite: NOT run this sitting.**
- **Docker: NOT run.** Dennis said it was on and the gate is end-loaded, so
  it is the next thing after the native suites. **No stack running, no
  containers or volumes created by this sitting.** The previous note's 35
  anonymous volumes and `api/backend/coverage/` (33MB, mtime 2026-09-04)
  are untouched and still need Dennis.
- **When that bring-up happens it needs `--build`.** This sitting touched
  `api/backend/src`, and `backend-app-test`/`frontend-app-test` are
  build-not-mount services, so the overlay's recipe as written reuses a
  stale image. `[read it]` `docker-workflow`'s bioavanced overlay records
  this being hit three times by sessions that had just read the warning.

## The three things a next session must not undo

**1. #1111's post-#575 branch is NOT "exists and decrypts", deliberately.**
An identity record that decrypts to no `patientName` is still reported as
drifted. `[read it]` `backfillParticipantIdentities`, in the same file and
on the same script run, creates an **all-null** identity record for a
post-#575 Patient — `ParticipantIdentityModel.fieldsOf` nulls every absent
field and `create()` requires only `participantId`. Relaxing the check to
mere existence would make the gate open on data that was never backfilled,
which is the one thing it exists to prevent. A test pins it.

**2. #1114's removal is NOT an invitation to enforce the vocabulary
elsewhere.** `[ran it]` production emits **54** distinct `resourceType`
literals and **42** are outside the list that was removed, including
`Settings` from `auditLogger`'s own `logLanguageChange`. Rejecting them
fails the audit write; coercing them to `'Sistema'` rewrites the
resourceType on an immutable hash-chained trail. Tests pin both directions
as red.

**3. `audit.middleware.js`'s copy of that list is load-bearing and was left
alone.** `determineEntity` genuinely consults it. That is now the only
enforced audit vocabulary in the codebase — which is what #1115 is about.

## #1115 is the live one, and it is deferred with a named expiry

`checkParticipantIdentityParity`'s sibling problem: `[ran it]`
`determineEntity` resolves only **14 of the 59** `/api` prefixes `app.js`
mounts. The other 45 — including `security`, `legal-holds`,
`retention-policies`, `e-consent`, `backup` and `audit` itself — record
`resourceType: 'Sistema'` on every automatic audit row, against dict-02
`P1X-0326` ("Tipo da entidade afetada", `1..1 Core`).

**Deferred under the absorption rule's exception 4, with the specific
conflict named:** the full backend regression is in flight against this
exact tree and the Docker gate is queued behind it; editing
`audit.middleware.js` now invalidates both. **That deferral expires the
moment the gates land** — if this sitting continues past them, #1115 is
due, not optional.

## Fixture lesson that generalises past these two issues

**Every pre-existing fixture in this identity family is pre-#575-shaped** —
the Patient still carries `patientName`/`birthDate`/`identityDocument`.
That is why #1111's 5 green parity tests and #1113's 13 green service tests
both missed live defects, and the two were found independently. Assume it
of any other test touching `patients` + `participantIdentities` before
trusting a green run there.

## The judgment a query cannot carry

- **The root `npm test` is blocked by `full-suite-guard`**, even though it
  is the repo's own full-suite script. The sanctioned pre-handoff form is
  `npx vitest run tests/unit tests/integration tests/compliance
  --reporter=dot` from `api/backend`, and the frontend equivalent names the
  seven directories under `src/`. The conventions skill cites this run's
  *duration* but not its *command*, so you learn the command by being
  blocked once.
- **`git ls-files` emits repo-root-relative paths and the runner's cwd is
  the package dir.** `sed 's|^api/backend/||'` or the sweep names N files
  and executes zero. Already documented; it bit again in the shape of a
  consumer-list regex that matched `participant-identity` but not
  `patient-identity`, which the "read the derived list" habit caught.
- **A patch script's anchor must be EOL-converted per file.** All six files
  touched this sitting are CRLF. The same trap then reappeared *inside* a
  probe that sliced source text with an `\n`-containing marker and found
  nothing — the conversion rule is usually stated for anchors, and a marker
  is the same thing wearing a different name.
- **`node --check` is valid for these patch scripts** because
  `api/backend/package.json` declares `"type": "commonjs"` explicitly and
  the scripts are `.cjs` — the #823 false-positive does not apply to a CJS
  payload.
- **Two concurrent native runs contend for CPU on this machine**, not just
  two runs against one stack. That is why the Docker gate was not started
  alongside the backend regression.
