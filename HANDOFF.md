# HANDOFF

**Written 2026-09-08, twenty-sixth queue sitting. INTERIM — no end signal was
given, so treat the session as CONTINUING.** Dennis asked to read the handoff,
pick the next *group* of issues, and said Docker was on. I took the previous
note's recommended list — **#1111, #1114, #1113** — and the two issues that
work turned up, **#1115** and **#1116**. All five are closed and every gate
has run green.

## What shipped

Branch `feature/docker-e2e-backend-integration`, tree clean and matching
origin. `main` untouched and still frozen.

| commit | issue | what |
|---|---|---|
| `3a0f3e04` | **#1113** | `matchOrUpsertParticipant` reads its identity fallbacks off the mirror, decrypted; omits absent fields instead of nulling stored ones |
| `610804c0` | **#1111** | the parity gate compares only fields the Patient still carries, so `isFullParity` is reachable — plus an emptiness check so it cannot open vacuously |
| `713168b2` | **#1114** | `Log.js`'s inert `VALID_ENTITIES` removed; `premise-corrected` |
| `a84eaa63` | **#1115** | one audit-entity vocabulary covering every mounted `/api` route, pinned by a new architecture test |
| `4a51a916` | **#1116** | `security.service.js` emits dict-02's canonical `SecurityConfiguration` |
| `fde868a2` | Refs **#1117** | records the pre-`a84eaa63` audit cutoff beside `ENTITY_MAP` |

**#1117 is OPEN and is the only thing awaiting anyone.** Query the tracker for
state — `gh issue list --state open`.

## Gates — all green, covering every commit through `a84eaa63`

- **Backend 466 files / 8806 tests** (was 8783). From `api/backend`:
  `npx vitest run tests/unit tests/integration tests/compliance --reporter=dot`.
- **Frontend 32 files / 264 tests.** From `frontend`: the seven `src/`
  directories named explicitly. (`npm test` at the root is blocked by
  `full-suite-guard`; pack #842 filed.)
- **Architecture 131/131**, `npm run typecheck` clean.
- **Docker e2e 223/223, twice** — before #1115 and again after rebuilding
  `backend-app-test`, since that fix is middleware on every request.

**`4a51a916` and `fde868a2` landed after the last e2e run.** Both are
natively covered (34 files / 842 tests; architecture 131/131) and neither has
an e2e surface — no spec references `SecurityConfig`, and `fde868a2` is
comment-only — but the Docker gate has not literally run against them.

**The stack is DOWN and its volumes are gone** — Dennis's call at cleanup
(`down --volumes` plus `docker volume prune -f`). The next gate starts cold:
12 core services with `--build`, then `admin-bootstrap-test`, then the
17-service bootstrap chain. Images kept (33, 8.697GB, none active), build
cache pruned (1.055GB — `docker system df` claimed 16.34MB, `docker buildx du`
had it right).

## Recommended next

**Nothing queued by name.** The branch is at its cleanest: five issues closed,
every gate green, tree matching origin. That makes this the natural moment for
**`ship-integration-branch`** — the PR to `main` is where real CI signal comes
from, and it is Dennis's call, never yours.

## Things a next session must not undo

1. **#1111's post-#575 branch is NOT "exists and decrypts".** An identity that
   decrypts to no `patientName` is still drifted, because
   `backfillParticipantIdentities` creates all-null records for post-#575
   Patients and accepting those would open the gate on data never backfilled.
2. **#1114's removal is not licence to enforce the vocabulary.** 42 of 54
   emitted `resourceType` literals were outside the removed list. Tests pin
   both wrong directions as red.
3. **`NO_ENTITY_ROUTES` is a decision, not a gap** — `health`, `dictionary`,
   `phone-codes`, `intake-wizard`. `audit-entity-coverage.arch.test.js` fails
   if a new router is neither mapped nor declared.

## Fixture lesson that generalises

**Every pre-existing fixture in the identity family is pre-#575-shaped**, so
the Patient still carries `patientName`/`birthDate`/`identityDocument`. That
is why #1111's 5 green parity tests and #1113's 13 green service tests both
missed live defects. Assume it of any test touching `patients` +
`participantIdentities`.

## The judgment a query cannot carry

- **A can-it-fail probe must not stash a whole file when the fix ADDS an
  export the test imports.** All five reds were `determineEntity is not a
  function` — no assertion evaluated — and 5-of-7 red reads as *stronger* than
  the correct 2-of-7. Revert only the behaviour sites. Pack #841.
- **For a detector, the probe is necessary and not sufficient**: measure the
  population too. 42 real offenders caught when disabled, 0 when enabled.
- **A single-segment mount pattern was blind to `/api/v1/patients`** — a live
  instance of the very defect the test was written for.
- **`--wait` lies in both directions**: exit 1 for `admin-bootstrap-test`
  which had `Exited (0)`, exit 0 for a 12-service bring-up. `docker ps -a` per
  container is the only signal.
- **Patch-script anchors need per-file EOL conversion** (all files here are
  CRLF), and the bounded-count check earned its keep three times — two
  non-unique anchors and one wrapping mismatch, each a clean exit 1.
