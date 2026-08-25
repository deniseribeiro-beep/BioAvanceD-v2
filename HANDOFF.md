# HANDOFF

**INTERIM — SESSION IN PROGRESS, NOT A FINAL HANDOFF.**

**Written:** 2026-08-25 (eighth sitting of the day), after queue item 3
of 4. Dennis asked for the next group of issues and confirmed **Docker
is on**. **1 of 4 queue items remains** and the session is still going.
Do not read this as the sitting's final word.

## The queue

Self-picked this sitting, explicitly numbered in the `issue-loop`
invocation's args so `queue-continue-checkpoint.cjs` can see it. Theme:
**finish RNF011 AC#4, and stop the sample list from lying about
consent.**

| # | What | Route | Status |
|---|---|---|---|
| **0** | the inherited Docker gate | gate | **done, green** |
| **787** | RNF011 AC#4 LGPD import quarantine | build-loop | **closed** (code had merged `00fee0a8`) |
| **788** | consent badge read from a field no writer sets | fix-bugs | **closed** `28629279` / merged `8547134e` |
| **790** | no empty-row guard in the import loops | fix-bugs | **closed** `f4259f6b` / merged `d08bc87d` |
| **794** | slice 1: `GET /api/import/lgpd/batches/:batchId` | build-loop | **next, last item** |

**Deliberately excluded, all still open:** **#789**, **#793**, **#792** —
each blocked on a decision by its own body.

**Flagged to Dennis, not queued:** **#684** — any authenticated user can
revoke any patient's consent by enumerating a Mongo `_id`. Highest
severity on the board, still blocked on RF010/RF021's actor model.
Offered twice this sitting as a swap; not taken.

## The issue-body reliability pattern, updated

Four of the five bodies read this sitting and last were wrong somewhere;
**#790's was accurate in every particular** — the first that held. So the
rule is *check*, not *distrust*: re-running the trace is cheap and has
now both caught four errors and confirmed one body clean.

- **#788** understated its own severity (below).
- **#790** — verified correct: `importPatients` guards twice then counts;
  `importSamples` and `importPatientsSmart` neither guard nor wait.

**#794's body is the one still unverified. Re-trace it before sizing.**

## What #788 actually was

Not the `PATIENT_NOT_FOUND` it predicted. Every row returned
`NO_ACTIVE_CONSENT`, meaning the lookup **matched a patient — the wrong
one**. All 7 patient docs lack `patientID`, so `{ patientID: null }`
matched all of them and `findOne` returned whichever came first: every
sample on every page badged from one arbitrary patient's consent record.
Direction of failure decided by document order, not data. The second new
unit test shows the sharp end: **before the fix, a sample with no
participant identifier at all returned `canUse: true`, "TCLE Assinado".**

Fixed by keying on `sample.participantId` **and** guarding the
missing-value case so the filter cannot degenerate to `{ field: null }`.

## What #790 was

`importSamples` and `importPatientsSmart` had no empty-row guard;
`importPatients` had two. A trailing blank row — normal Excel output —
became a spurious identity-resolution rejection, and **since #787 was
also quarantined as if it were a real data problem**. Now one shared
`isEmptyRow(row)` in all three loops, called **before** the
`results.total` increment so #786's `total === success + errors`
invariant is untouched. Chose silent skipping (the file's established
behaviour); the alternative is filed as **#798**.

## Filed this sitting

**Product:** **#795** (`POST /api/samples` writes `Paciente ID:
undefined` into the RF004 audit trail and drops the key from its 201
body), **#796** (`persistConsentDeliveryFailure` is a permanent no-op —
both callers pass `participantId`, it reads `patientID`/`patientId`/`id`,
so consent-delivery failures are recorded nowhere), **#797** (520
filter-ignoring `findOne` mocks across 56 files — the #771 blindness one
method over, and what kept #788 green through five tests covering it),
**#798** (blank rows now dropped with no signal, so a truncated upload
looks identical to a clean one).

**Pack:** **#444**, **#445**, **#446**, **#447**, **#448**, plus
refinements on **#442** and **#410**.

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**.
- No `fix/` branches outstanding — both this sitting's were deleted local
  **and** remote, no prompt either time.
- Untracked and deliberately untouched: `.claude/skills/` and
  `api/backend/storage/assays/`. **Never `git add -A`.**
- Older local branches unchanged: `fix/599-ci-trigger-integration-branch`
  and `fix/599-hold-ci-trigger-for-milestone` are merged (safe to
  delete); `test/377-docs-on-main` and `test/human-showcase-video` are
  not merged.
- Two stale *remote* branches left alone deliberately (they predate this
  session): `origin/fix/705-seed-active-terminology-concept-cleanup` and
  `origin/test/377-docs-on-main`. **Verify merge status *and* per-commit
  authorship before deleting** (precedent #332).
- The known **#752** red is unchanged and pre-existing; not re-checked.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Docker

**On, authorized by Dennis. Stack is UP and gate-ready** — record both
axes, per pack #445:

- **Services:** 12 core, healthy, up since ~19:26 on 2026-08-25.
- **Bootstrap:** `admin-bootstrap-test` **and** the full 17-service
  reference-data chain have run this sitting; all 18 one-shots verified
  `Exited (0)` via `docker ps -a`, not by the compose exit code.
- **`backend-app-test` has been rebuilt twice**, and currently carries
  **both** #788's and #790's fixes. It is build-not-mount: **any further
  `api/backend/src` change needs another rebuild before an e2e run**, or
  the stale image serves old code with no error.
- **Volumes:** the four named fixture volumes are untouched. A
  from-scratch gate needs `docker volume rm` on
  `bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data` first, then
  the whole bootstrap chain again.
- `playwright-runner` has never been started on this stack. **Stop it
  before any host-side run if that changes** (pack #437).
- `lgpd-sample-import.spec.ts` has been run **twice** this sitting, 5/5
  both times — once as the gate, once as #790's regression check.
- Host Playwright command (verbatim, works):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- **Hand-seeding Mongo needs the logical→physical name map** (pack #447):
  `getCollection(db, 'consents')` reads the collection physically named
  **`patientConsents`** per `api/backend/src/config/collections.js`.
  Seeding the wrong name does not error — it creates a stray collection
  and the verification reads as a failed fix.

## Working rules holding this sitting

- **`gh issue close` has NO `--body-file` flag** — post the long comment
  first with `gh issue comment --body-file`, then close separately.
- **A hook-blocked Bash call writes none of its files; the block is
  atomic over the whole tool call — the separator is irrelevant.**
  Framing this as an `&&`-chaining rule is too narrow.
- **Every `gh issue create` must carry `--label`** (pack #148 hook).
- **Splicing a block into a file: take the anchor line number from
  `awk 'NR>=A && NR<=B {printf "%d|%s\n", NR, $0}'`, never by counting
  `sed -n 'A,Bp'` output by eye** (pack #448). An off-by-one nests the
  block inside the preceding test — valid syntax, so nothing errors; the
  only symptom is a quietly reduced collected-test count. Recovery is
  `git checkout --` and re-splicing, not repairing by index. Cost one
  full reset this sitting.
- **The routing gate's re-arm is NOT an unconditional per-iteration
  tax** (correction to what this file has been claiming; see pack #442).
  It re-arms only when a `gh issue view`/`list` happens *after* the
  routed-skill invocation. #788's close re-armed it because the
  iteration duplicate-checked the tracker before filing #795; #790's
  close did not, and went through first try. Budget the extra
  invocation for iterations that file a found-bug issue.

## Recommended next steps

**Finish the queue — #794 slice 1 is the last item**, routed to
`build-loop`.

Its body proposes three pieces and says item 1 alone is independently
landable: `GET /api/import/lgpd/batches/:batchId` returning the batch and
its quarantined rows, RBAC-gated to whoever may import. That is the
slice. The FHIR path is the stated reference —
`GET /api/import/fhir/batches/:id`, covered by `interop-monitoring.spec.ts`
— so mirror it rather than inventing a shape, the same way #787 mirrored
`fhir-import-staging.service.js`. Docker is on and the stack is warm, so
the real-backend test `build-loop` wants is cheap to run; remember the
`backend-app-test` rebuild first.
