# HANDOFF

**Written 2026-09-08, twenty-sixth queue sitting. INTERIM — no end signal was
given, so treat the session as CONTINUING.** Dennis asked to read the handoff,
pick the next *group* of issues, and said Docker was on. I took the previous
note's recommended list — **#1111, #1114, #1113** — plus **#1115**, which the
#1114 work turned up. **All four are done and every gate has run green.**

## What shipped

Branch `feature/docker-e2e-backend-integration`, tree clean and matching
origin. `main` untouched and still frozen.

| commit | issue | what |
|---|---|---|
| `3a0f3e04` | **#1113** closed | `matchOrUpsertParticipant` reads its identity fallbacks off the mirror, decrypted, and omits absent fields instead of nulling stored ones |
| `610804c0` | **#1111** closed | the parity gate compares only the fields the Patient still carries, so `isFullParity` is reachable again — plus an emptiness check so it cannot open vacuously |
| `713168b2` | **#1114** closed | `Log.js`'s inert `VALID_ENTITIES` removed; labelled `premise-corrected` |
| `a84eaa63` | **#1115** closed | one audit-entity vocabulary covering every mounted `/api` route, pinned by a new architecture test |

Query the tracker for state — `gh issue list --state open`.

## Gates — ALL GREEN, and they now cover every commit on this branch

The previous note's three commits had never been through a full suite. They
have now.

- **Backend regression 466 files / 8806 tests**, exit 0 (606s). Form:
  `npx vitest run tests/unit tests/integration tests/compliance
  --reporter=dot` from `api/backend`. Previous known-green was 8783.
- **Frontend 32 files / 264 tests**, exit 0. Form: the seven `src/`
  directories named explicitly.
- **`npm run test:architecture` 131/131** (124 + 7 new from #1115).
- **`npm run typecheck`** clean.
- **Docker e2e 223/223**, twice — once before #1115 and again after, with
  `backend-app-test` rebuilt, because that fix touches middleware on every
  request. `--workers=1`, host-side, full 17-service bootstrap chain.

**The stack is DOWN, and its volumes are gone — Dennis's call at cleanup.**
`down --volumes` plus `docker volume prune -f`: zero containers, zero
volumes. **So the next gate starts genuinely from scratch** — bring up the
12 core services (with `--build` if source changed), then
`admin-bootstrap-test`, then the 17-service foundation/reference-data chain,
per `docker-workflow`'s bioavanced overlay. Budget for that; it is not a
warm stack.

The upside is that the fixture-accumulation class the overlay warns about
(specs asserting "the first event of its kind") cannot bite the next run.
Images are kept — 33, 8.697GB, nothing active — so the rebuild is layer
cache, not a cold pull. Build cache was pruned (1.055GB;
`docker system df` claimed 16.34MB, `docker buildx du` had it right).

## Recommended next

**Nothing queued by name.** Dennis named no follow-up, so this is a
suggestion, not a queue.

The branch is in the cleanest state it has been in: four issues closed, every
gate green, tree matching origin. **That makes this the natural moment for
`ship-integration-branch`** — the PR to `main` is where real CI signal comes
from, and it is Dennis's call, never yours.

## Things a next session must not undo

**1. #1111's post-#575 branch is NOT "exists and decrypts", deliberately.**
An identity record that decrypts to no `patientName` is still reported as
drifted. `[read it]` `backfillParticipantIdentities`, in the same file and on
the same script run, creates an **all-null** identity record for a post-#575
Patient. Relaxing this to mere existence opens the gate on data that was
never backfilled — the one thing it exists to prevent. A test pins it.

**2. #1114's removal is NOT an invitation to enforce the vocabulary.**
`[ran it]` production emits **54** distinct `resourceType` literals and **42**
were outside the removed list, `Settings` among them from `auditLogger`'s own
`logLanguageChange`. Rejecting them fails the audit write; coercing them to
`'Sistema'` rewrites the resourceType on an immutable hash-chained trail.
Tests pin both wrong directions as red.

**3. `audit.middleware.js` now has ONE vocabulary, and `NO_ENTITY_ROUTES` is
a decision, not a gap.** `health`, `dictionary`, `phone-codes` and
`intake-wizard` are declared entity-less on purpose.
`audit-entity-coverage.arch.test.js` fails if a newly mounted router is
neither mapped nor declared — that test *is* the fix, because the defect was
drift rather than the missing entries.

## Fixture lesson that generalises

**Every pre-existing fixture in the identity family is pre-#575-shaped** —
the Patient still carries `patientName`/`birthDate`/`identityDocument`. That
is why #1111's 5 green parity tests and #1113's 13 green service tests both
missed live defects. Assume it of any test touching `patients` +
`participantIdentities` before trusting a green run there.

## The judgment a query cannot carry

- **A detector's can-it-fail probe must not stash the whole file.** `[ran it]`
  stashing `audit.middleware.js` removed the new *exports*, so all five reds
  were `determineEntity is not a function` — assertions never evaluated, and
  a very convincing 5/7 failure that proved nothing. Revert only the
  behaviour sites. The valid probe gave 2 fail / 5 pass with every control
  green, and **42 real offenders caught when disabled versus 0 when
  enabled**, which is the population delta a detector owes on top of the
  probe.
- **A single-segment mount pattern is blind to `/api/v1/patients`.** My first
  draft of that arch test could not see a live instance of the very defect it
  was written for. A pattern that cannot match the shape it hunts returns a
  confident, wrong number — the widened pattern is now itself pinned by a
  test.
- **The root `npm test` is blocked by `full-suite-guard`**, though it is the
  repo's own full-suite script. The sanctioned forms are in the guard's block
  message; the conventions skill cites this run's *duration* but not its
  *command*, so you learn the command by being blocked once.
- **`--wait` lies in both directions, confirmed again.** It reported exit 1
  for `admin-bootstrap-test` which had `Exited (0)`, and exit 0 for a
  12-service bring-up. `docker ps -a` per container is the only signal.
- **Patch-script anchors need per-file EOL conversion** — all files touched
  here are CRLF — and the same trap reappears *inside* a probe that slices
  source text with an `\n`-containing marker, where it does not read as an
  "anchor" at all.
- **Two concurrent native runs contend for CPU on this machine**, not just
  two runs against one stack. The Docker gate was held until the backend
  regression finished for this reason.
