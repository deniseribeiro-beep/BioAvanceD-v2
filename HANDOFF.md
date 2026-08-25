# HANDOFF

**Written:** 2026-08-25, end of the eighth sitting of the day. The
self-picked 4-item queue is **empty — all items resolved**. This is the
definitive rotation for this sitting.

## What this sitting did

Dennis asked for the next group of issues and confirmed **Docker on**.
Theme: **finish RNF011 AC#4, and stop the sample list from lying about
consent.**

| # | What | Route | Outcome |
|---|---|---|---|
| **0** | the inherited Docker gate | gate | **green, 5/5** |
| **787** | RNF011 AC#4 LGPD import quarantine | build-loop | **closed** (code had merged `00fee0a8`) |
| **788** | consent badge read from a field no writer sets | fix-bugs | **closed** `28629279` / merged `8547134e` |
| **790** | no empty-row guard in the import loops | fix-bugs | **closed** `f4259f6b` / merged `d08bc87d` |
| **794** | quarantine unreadable — slice 1 of 3 | build-loop | **slice landed** `8dca6f95` / merged `0521f96c`; **issue deliberately still OPEN** |

### The gate (item 0)

**The inherited stack was up but NOT gate-ready** — `docker ps -a` showed
no `admin-bootstrap-test` and no reference-data chain at all. Fixed in
~50 s. Then `lgpd-sample-import.spec.ts` ran 5/5, executing for the first
time the **three assertions deferred from #785/#786** plus #787's two new
quarantine cases. **No reopens** — both prior closes confirmed live.

### #788 — the issue understated its own severity

Predicted every row returning `PATIENT_NOT_FOUND`. Reality: every row
returned `NO_ACTIVE_CONSENT`, i.e. the lookup **matched a patient — the
wrong one**. All 7 patient docs lack `patientID`, so `{ patientID: null }`
matched all of them and `findOne` returned whichever came first. Every
sample on every page was badged from one arbitrary patient's consent
record, with the direction of failure decided by document order. The
sharp end, from the new unit test: **before the fix, a sample with no
participant identifier at all returned `canUse: true`, "TCLE Assinado".**

### #790 — the first body that held

`importSamples` and `importPatientsSmart` had no empty-row guard;
`importPatients` had two. Now one shared `isEmptyRow(row)` in all three,
**before** the `results.total` increment so #786's
`total === success + errors` invariant is untouched. Chose silent
skipping (the file's established behaviour); the alternative is **#798**.

### #794 slice 1

`GET /api/import-lgpd/batches/:batchId` — the quarantine is now readable
through the API, not only via Mongo. **Two corrections to the body:** its
proposed path `/api/import/lgpd/...` doesn't match this repo (LGPD mounts
at `/api/import-lgpd`, `app.js:350`; `/api/import` is the FHIR router),
and "gated to whoever may import" resolves to the **existing**
`createSample` permission — deliberately not a new one, since a new
permission never reaches an already-seeded stack without an explicit
`seedRbacCatalog.js` re-seed.

## The issue-body reliability pattern

**Five of six bodies read across this queue were wrong somewhere; #790's
was the one that held.** The rule is *check*, not *distrust* — re-running
the trace is cheap and has now caught five errors and confirmed one body
clean. #788's error was in the direction of **understating** severity,
which is the dangerous direction.

## Filed this sitting

**Product:** **#795** (`POST /api/samples` writes `Paciente ID:
undefined` into the RF004 audit trail and drops the key from its 201
body), **#796** (`persistConsentDeliveryFailure` is a permanent no-op —
both callers pass `participantId`, it reads `patientID`/`patientId`/`id`),
**#797** (520 filter-ignoring `findOne` mocks across 56 files — the #771
blindness one method over, and what kept #788 green through five tests
covering it), **#798** (blank rows now dropped with no signal),
**#799** (`GET /api/import/fhir/batches/:id` has no type filter, so it
serves LGPD quarantine batches — with civil identifiers — to a different
permission), **#800** (self-report: both import batch readers check
permission but not ownership; same class as #684).

**Pack:** #444, #445, #446, #447, #448, #449, plus refinements on #410
and #442.

## Repo state

- On `feature/docker-e2e-backend-integration`, **in sync with origin**.
- **No `fix/` or `test/` branches outstanding** — all three created this
  sitting were deleted local *and* remote, no prompt any time.
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

**The stack is DOWN and the four named volumes were dropped.** Dennis
chose a full teardown at the `clean-up` checkpoint, so **the next sitting
starts cold on purpose** — this is not an abandoned environment, and
there is no warm stack to inherit. Record both axes (pack #445):

- **Services:** none running. The 12-service stack was up from ~19:26
  until the end of this sitting, then `docker compose ... down`, verified
  by `docker ps` rather than the compose exit code.
- **Bootstrap:** `admin-bootstrap-test` **and** the full 17-service
  reference-data chain ran this sitting; all 18 one-shots verified
  `Exited (0)` via `docker ps -a`, never by the compose exit code.
- **`backend-app-test` was rebuilt three times** this sitting and its
  image still carries **#788, #790 and #794** (the image was kept; only
  containers and volumes went). Build-not-mount: **any further
  `api/backend/src` change needs another rebuild before an e2e run**, or
  a stale image serves old code with no error.
- **Volumes:** all four (`bioavanced-test_{mongodb,neo4j,influxdb,redis}-test-data`)
  were **removed**, clearing e2e fixture data accumulated across several
  prior sittings. **A next sitting therefore needs the full startup from
  scratch**: the 12-service recipe with `--build`, then
  `admin-bootstrap-test`, then the whole 17-service reference-data chain
  — the chain is not optional now, since nothing is seeded.
- `playwright-runner` was never started. **Stop it before any host-side
  run if that changes** (pack #437).
- `lgpd-sample-import.spec.ts` ran **four times**, green each time,
  finishing at **8/8** after #794's three new cases.
- Host Playwright command (verbatim, works):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- **Hand-seeding Mongo needs the logical→physical name map** (pack #447):
  `getCollection(db, 'consents')` reads the collection physically named
  **`patientConsents`** per `api/backend/src/config/collections.js`.
  Seeding the wrong name does not error — it creates a stray collection
  and the verification reads as a failed fix.

## Working rules confirmed this sitting

- **`gh issue close` has NO `--body-file` flag** — post the long comment
  first with `gh issue comment --body-file`, then close separately.
- **A hook-blocked Bash call writes none of its files; the block is
  atomic over the whole tool call — the separator is irrelevant.**
  Framing it as an `&&`-chaining rule is too narrow.
- **Every `gh issue create` must carry `--label`** (pack #148 hook).
- **Splice anchors come from `awk 'NR>=A && NR<=B {printf "%d|%s\n", NR,
  $0}'`, never from eyeballed `sed -n` output** (pack #448). An
  off-by-one nests the block inside the preceding test — valid syntax, so
  nothing errors; the only symptom is a quietly reduced collected-test
  count. Recovery is `git checkout --` and re-splicing, not repairing by
  index. Cost one full reset.
- **A negative-path test on a not-yet-built endpoint passes vacuously**
  (pack #449) — an unregistered route 404s just like the handler would.
  **Read which tests passed in the red run, not just that one failed**,
  and assert the response *shape*, not the status alone.
- **The routing gate's re-arm is NOT a flat per-iteration tax** — it
  re-arms only when a `gh issue view`/`list` happens *after* the routed
  skill call. #788's close re-armed (the iteration duplicate-checked the
  tracker before filing #795); #790's and #794's did not.

## Recommended next steps

**None queued — Dennis has not named the next group.** When he does,
these are the strongest candidates, in the order I'd argue for them:

1. **#684** — offered twice this sitting and not taken. Still the
   highest-severity item on the board: any authenticated user can revoke
   any patient's consent by enumerating a Mongo `_id`. Blocked on
   RF010/RF021's actor model, a product call. **#800 filed this sitting
   is the same class**, so a single decision about object-ownership
   scoping would now unblock both.
2. **#799** — a concrete, small, security-relevant fix (add the type
   filter to the FHIR reader) with no design question attached.
3. **#794 items 2 and 3** — the UI surface and correct-and-resubmit, to
   finish RNF011 AC#4 properly.
4. **#797** — the filter-ignoring mock sweep, which is what let #788 hide
   behind five green tests. Pair with #781, which proposes the same
   drawer for the sort-capturing helper.
