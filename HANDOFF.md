# HANDOFF

**Written:** 2026-08-07, end of session on `feature/docker-e2e-backend-integration`,
after resolving #502.

## What happened this session

Dennis said "pick #502". `work-issue` routed it: #502 was a design-call
issue (MerkleService's resolved-snapshot integrity hash resolves the
*newest* RcsAssessment/SpecimenPreanalytics snapshot for a specimenId,
which would false-positive a tamper report if a later re-assessment ever
recorded a newer snapshot for an already-sealed sample). Asked Dennis to
pick between the issue's two proposed options via `AskUserQuestion` —
he chose (a): pin integrity verification to the snapshot that existed
at seal time, rather than (b) keeping integrity hashing on the legacy
embedded fields permanently.

With the design decided, re-routed through `work-issue` -> `build-loop`
(the capability — seal-time snapshot pinning — didn't exist in the code
at all yet, so this was route 4, not `fix-bugs`/`test-loop`).

**Implementation** (one slice, no split needed):
- `Sample.js` gained `sealedRcsAssessmentId`/`sealedSpecimenPreanalyticsId`
  (schema + `SampleModel.create()` defaults). Confirmed via
  `dict-02_DICIONARIO.md`/`requisitos-index.md` (build-loop's
  primary-doc-before-editing gate) that no dict-02 entity covers this —
  it's an implementation detail of `MerkleService`'s per-sample hash, not
  part of dict-02's own (separate, not-yet-built) `MerkleRoot` stub
  entity (P1X-0162..0167).
- `rcs-assessment.service.js`/`specimen-preanalytics.service.js` gained
  `getAssessmentById`/`getProfileById` (resolve one snapshot by `_id`,
  vs. the existing `getAssessmentsForSpecimen`/`getProfilesForSpecimen`'s
  "newest first" resolution).
- `MerkleService.generateSampleHashFromSample` now resolves the pinned
  snapshot by `_id` when `sealedRcsAssessmentId`/
  `sealedSpecimenPreanalyticsId` is present as an own-property on the
  sample document (checked via `hasOwnProperty`, not truthiness — `null`
  means "sealed with no snapshot," absent means "written before this pin
  existed"). Falls back to the pre-#502 "resolve newest" behavior only
  for that second case, preserving hash stability for samples already in
  the DB.
- `import.service.js` (both the JSON branch and the CSV/XLSX branch) and
  `import-lgpd.service.js` now capture the `_id` of whichever
  RcsAssessment/SpecimenPreanalytics snapshot `recordAssessment`/
  `recordProfile` just persisted and pin the sample to it via a follow-up
  `updateOne`.
- `intakeWizard.js`'s `buildSampleDocumentFromIntake` explicitly sets
  both pin fields to `null` (it never records a snapshot) so the sample
  document carries the own-property and always falls back to the legacy
  embedded-field hash — never accidentally picks up a later snapshot via
  the old "resolve newest" path.
- `docs/architecture/canonical-data-contract-v1.md`'s RcsAssessment
  section got a new paragraph recording the landed fix, same pattern
  #500's finding used.

**Tests:** added `getAssessmentById`/`getProfileById` unit tests (same
real-query-matching-fake style as the existing
`getAssessmentsForSpecimen`/`getProfilesForSpecimen` tests; extended the
fakes' `insertOne` to mutate `doc._id` the way the real MongoDB driver
does, since the pin logic depends on that). Added a
`SampleGraphValidator` test proving the actual bug scenario: a sample
sealed against one RcsAssessment snapshot, a second (newer) snapshot
recorded afterward for the same specimenId, integrity check still
passes because it resolves the pinned snapshot, not the newest.

**Fixed two pre-existing tests whose assertions assumed the old
"no extra updateOne" shape** (`import-lgpd.service.importSamples.unit.test.js`,
`import.service.importSamples.test.js`) — both now correctly expect the
pin's `updateOne` call to fire alongside whatever they were actually
testing, asserting on the specific `$set` key they care about instead of
call count/absence. Also gave `import-lgpd.service.importSamples.unit.test.js`'s
`rcsAssessmentsCollection.insertOne` mock the same real-driver `_id`
mutation.

Ran the full `api/backend/tests/unit` suite (283 files, 5749 tests) —
8 pre-existing failures, all unrelated to this change (`UserModel.getRoleName`
missing, part of the open RBAC retirement series #427/#428; a dictionary
generator checksum drift, unrelated script). Zero regressions from this
session's diff.

**Filed #504** (`wrap-up`'s security/safety-relevant-change rule): the
backward-compat fallback that keeps "resolve newest" for samples written
before this pin existed means those samples are *still* exposed to
#502's original bug if a re-assessment flow is ever built without also
backfilling their pin fields. No live re-assessment flow exists today
(same as #502's own premise), so this is a flagged-for-later item, not
an active bug.

Branch `test/502-merkle-integrity-seal-time-pin` (off
`feature/docker-e2e-backend-integration`, following the repo's `test/`
fallback prefix — no dedicated `build-loop` prefix exists yet per the
overlay), one commit, fast-forward merged back in, local branch deleted.
Pushed `feature/docker-e2e-backend-integration`. Closed #502 with a
comment summarizing the fix and pointing at the commit + doc section.

No other friction this session (`wrap-up` ran in full).

## Repo state

- **`feature/docker-e2e-backend-integration`**: clean, pushed, up to
  date with origin as of this session (commit `9e04b53a`, "Resolve #502:
  pin MerkleService integrity verification to seal-time
  RcsAssessment/SpecimenPreanalytics snapshot").
- No dangling branches from this session.
- Issues this session: **#502 closed** (comment posted, references
  commit + doc). **#504 filed** (new, open — residual risk for
  pre-#502 samples, tracked for whenever a re-assessment flow is built).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

**#491** stays open as the tracking issue — 5 of 5 originally-listed
children resolved or closed as not-applicable (#497, #498, #499, #500,
#501) — but #491 itself (the general "migrate backend RCS consumers off
Sample.js embedded fields" umbrella) should stay open until the real
remaining consumers (MerkleService's *own* embedded-field reads outside
this session's #502 scope, neo4j projection, live registration path) are
actually migrated; those aren't yet split into their own child issues
beyond what #502 (now closed)/#492 already cover narrowly. Note:
`MerkleService.generateSampleHash` (the *base* function, not
`generateSampleHashFromSample`) still reads `sample.rcsScore`/
`calculationTrace`/`axisPenalties`/`sprec` directly off the sample
object — that's an intentional, still-open part of #491's scope, not
something this session's #502 slice touched (#502 only changed which
*snapshot* `generateSampleHashFromSample` resolves before calling the
base function).

**#493** (SPREC backend consumers, off #390) — 1 of 3 items done
(MerkleService, prior session). Still open:
- `import.service.js`'s JSON-import branch — needs
  `specimenPreanalyticsService.recordProfile` wiring (pairs with #501's
  RCS fix — likely the same shape, same file, just the SPREC half
  instead of RCS half; not picked up this session, stayed strictly to
  #502's scope).
- `sampleMerkleIntegrity.js` — confirm during implementation whether
  this belongs in backend scope or the frontend follow-up (#495).

**#503** (filed several sessions ago) — `import-lgpd.service.js`'s
`sample.sprec` never wired to `specimenPreanalyticsService.recordProfile`.
Not picked up this session.

**#504** (filed this session) — samples written before #502's pin
existed remain exposed to the original false-tamper bug; needs a
one-time backfill (`sealedRcsAssessmentId`/`sealedSpecimenPreanalyticsId`
set to the existing snapshot's `_id`) whenever a re-assessment/
correction/re-import flow is designed. No urgency today — no such flow
exists yet.

Other backlog carried forward unchanged from prior handoffs (not
re-verified this session):
- **#492** — design decision: should live `POST /api/samples`
  registration compute RCS server-side, or accept a pre-computed
  assessment from the client? (needs owner call before implementation;
  also the reason `intakeWizard.js` samples never get a
  RcsAssessment/SpecimenPreanalytics snapshot recorded today, which is
  why this session pinned those samples to `null` rather than wiring up
  new recording logic there)
- **#494** — storage/custody consumers (storageService, sample.service,
  Allocate/Move/Release use-cases, MongoStorageRepository*, intakeWizard,
  NotificationService, sensor services) — still unsplit.
- **#495** — frontend consumers. **Depends on #491, #493, #494 landing
  first.**
- **#496** — remaining misc backend surfaces from
  `canonical-data-contract-v1.md`'s "Known Residual Legacy Surfaces"
  list not covered by #491-#495.
- **#489** — full-suite vitest flakiness (89/360 files fail on a bare
  `npx vitest run`, unrelated to any recent diff, broadened scope of
  closed #423). This session's full-suite run (283 files under
  `tests/unit` specifically) saw only 2 failing files/8 failing tests,
  both independently explained (RBAC retirement series, dictionary
  checksum script) — worth a future session reconciling whether #489's
  original 89-file number was a different (broader) run scope, since
  `tests/unit` alone came nowhere close to that count.
- Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
  grep sweep, dangling merged branches (`test/440-*`, `test/441-*`,
  `fix/444-retention-period-iso8601`, `fix/450-*`,
  `fix/476-quarantine-status-design-call`,
  `fix/485-sample-details-storage-migration`,
  `test/486-storage-move-sample`, `test/488-inline-storage-movement-e2e`
  — all safe to delete, low priority housekeeping).
- **Next e2e slice** (per `E2E_TRACEABILITY_PLAN.md` and
  `playwright-specs`' spec inventory) — check issue #95's tracking
  thread once skills-pack#227 lands the new spec in the inventory.
- **#368** — the analogous Patient/ParticipantIdentity migration that
  #390's split pattern mirrored — is itself still unsplit. Not picked up
  this session.

## Dev stack state

Nothing started this session. Per the `build-loop` overlay, this slice
was backend-internal service/model logic (not one of the milestone's own
e2e Playwright specs), so the "real backend" proof bar was the strongest
native-only option — vitest against real-query-matching in-memory fakes
(mirroring the existing `rcs-assessment.service.test.js`/
`specimen-preanalytics.service.test.js` pattern), not literal Docker/
live Mongo. No `docker compose up` this session, nothing to tear down.

## Which skills to use

- `work-issue` -> (design decision via `AskUserQuestion`) -> `build-loop`
  was the correct routing: #502 named a genuine missing capability (the
  seal-time pin didn't exist in the code at all), not a defect in
  existing behavior (`fix-bugs`) or a coverage gap in already-correct
  code (`test-loop`). The mid-routing `AskUserQuestion` call (before
  `build-loop`, after the initial `work-issue` dispatch) is worth noting
  as a pattern: a design-call issue doesn't map directly to any of
  `work-issue`'s routes until the design question itself is answered —
  answer it first, *then* classify what the resulting concrete work
  looks like.
- `build-loop`'s "Picking a slice" primary-doc gate fired correctly on
  the `Sample.js` edit (a hook blocked the first attempt until
  `dict-02_DICIONARIO.md`/`requisitos-index.md` were read directly,
  not just `docs/architecture/`'s summary) — confirmed no dict-02 entity
  covers this concept, so the new fields are implementation-only and the
  doc update went to `docs/architecture/canonical-data-contract-v1.md`
  rather than proposing a dict-02 change.
- `build-loop`'s Docker-on-by-default note didn't apply here — the
  overlay's own carve-out for backend-internal (non-e2e-spec) slices
  correctly pointed at native vitest fakes instead; worth remembering
  this carve-out exists so a future session doesn't reflexively spin up
  Docker for every `build-loop` iteration regardless of what kind of
  slice it is.
- `wrap-up`'s security/safety-relevant-change rule (item 12) is what
  produced #504 — the residual backward-compat exposure wouldn't have
  gotten a tracked issue without that explicit checklist item; worth
  reconfirming it's still catching real things like this.
- No project board found for this repo, so boarding step was skipped —
  matches prior sessions' behavior.
