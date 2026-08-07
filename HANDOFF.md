# HANDOFF

**Written:** 2026-08-07, end of session on `feature/docker-e2e-backend-integration`,
after resolving #492.

## What happened this session

Dennis said "pick #492" — a design-decision issue asking whether live
`POST /api/samples` registration (`sample.service.js#createSample` via
`RegisterSampleUseCase.js`) should compute RCS server-side or accept a
pre-computed assessment from the client.

**Research before implementing:** checked all the docs #492 itself
pointed at (`canonical-data-contract-v1.md`, `canonical-active-surface.md`,
`canonical-data-cleanup.md`, the newest `docs-7-31-2026` plan doc,
`dict-07_ALINHAMENTO_CODIGO.md`/`dict-08_MAIN_GAPS.md`) — none stated an
answer; #492 itself had zero comments. Recommended server-side
computation (matches the repo's "backend autoritativo" pattern seen for
RBAC, and avoids trusting client-side math for something that feeds
quality/audit decisions). Then, before implementing, checked #492's own
point 3 ("is there a gap to close first?") by tracing
`RegisterSampleUseCase.js`'s actual inputs against what RCS computation
needs — found `api/backend/src/routes/intakeWizard.js` **already**
computes RCS server-side from a client-supplied `sprec` payload via
`qualityDomain.resolveMethodologicalQuality({ sprec })`, the same
function `import.service.js`'s CSV/XLSX branch uses (#383/#499). This
confirmed no new capability was needed — `resolveMethodologicalQuality`
is a pure function of `{ sprec }`, no other `RegisterSampleUseCase` input
required — just wiring, so it routed to `build-loop` (same shape as
#499/#502/#503/#504).

**Implementation** (one slice, `sample.service.js#createSample`):
- When the request body carries a non-empty `sprec`, calls
  `qualityDomain.resolveMethodologicalQuality({ sprec })` and maps the
  canonical RCS-GOV fields (`rcsScore`, `scoreBasedGrade`, `finalGrade`,
  `governanceStatus`, `axisPenalties`, `calculationTrace`,
  `rcsEvaluation`, ...) onto `sampleData` before `SampleModel.create` —
  identical field mapping to `import.service.js`'s CSV/XLSX branch.
- Once the sample has fully landed (ledger append **and** storage
  allocation both succeeded — deliberately later than
  `import.service.js`'s timing, so a sample rolled back by either of
  those failures never leaves a dangling `RcsAssessment` with no
  surviving sample), calls `rcsAssessmentService.recordAssessment` and
  pins `sealedRcsAssessmentId` per #502's convention, same best-effort
  (caught, logged, doesn't fail the create) error handling
  `import.service.js` uses.
- No `sprec` in the payload leaves behavior exactly as before (no RCS
  computed, no assessment recorded).
- `docs/architecture/canonical-data-contract-v1.md`'s RcsAssessment
  section got a new "Live registration RCS computation — landed #492"
  paragraph, and the "Not yet landed" paragraph above it had the
  live-registration-path clause removed (now landed).

**Tests:** `api/backend/tests/unit/sample.service.test.js`, 3 new cases
inside `createSample`'s existing describe block (computes + maps fields
+ records an `RcsAssessment` + pins `sealedRcsAssessmentId` when `sprec`
is present; no-op when `sprec` is absent, matching prior behavior;
sample creation doesn't fail when the assessment-recording call itself
rejects) — written and run first against the unimplemented capability
(failed: `resolveMethodologicalQuality` never called), then
implementation added, then re-run green. Full file (87 tests, up from
84) plus `RegisterSampleUseCase.test.js`, `sample.service.unit.test.js`,
`import-lgpd.service.importSamples.unit.test.js`, and
`rcs-assessment.service.test.js` (91 tests total across those four) all
green, no regressions. Backend-internal, non-e2e-spec slice, so per the
`build-loop` overlay's proof bar this was real-query-matching in-memory
fakes (mirroring `import-lgpd.service.importSamples.unit.test.js`'s own
`rcsAssessments`-collection mutate-on-insert fake), not literal
Docker/live Mongo.

Branch `test/492-live-registration-rcs-server-side` (off
`feature/docker-e2e-backend-integration`, same fallback-prefix
convention prior sessions used), one commit, fast-forward merged back
in, local branch deleted. Pushed `feature/docker-e2e-backend-integration`.
Closed #492 with a comment pointing at the commit hash, the design
decision + why, and the doc section.

`wrap-up` ran in full. One finding, filed and not just narrated:
**#505** — while tracing `intakeWizard.js`'s existing RCS computation as
the precedent for #492's implementation, confirmed it computes RCS via
`qualityDomain.resolveMethodologicalQuality` but never calls
`rcsAssessmentService.recordAssessment` or sets `sealedRcsAssessmentId`
— a real, previously-untracked gap (searched open+closed issues first;
none existed), out of #492's own scope (which was specifically the
`RegisterSampleUseCase`/`sample.service.js` path), filed as its own
issue rather than silently left as a doc footnote. No other friction:
no scope creep (diff limited to `sample.service.js`, its test file, and
the one doc section), no lazy fixes, no permission denials beyond the
expected protected-branch gate (worked as documented — required
branching before the first edit), no retries, no user correction needed,
targeted test runs kept context lean.

## Repo state

- **`feature/docker-e2e-backend-integration`**: clean, pushed, up to
  date with origin as of this session (commit `ff974237`, "Resolve #492:
  compute RCS server-side on live sample registration").
- No dangling branches from this session.
- Issues this session: **#492 closed** (comment posted, references
  commit + design decision). **#505 filed** (new, open) — `intakeWizard.js`
  computes RCS but never records an `RcsAssessment` snapshot.

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

**#505** (new this session) — `intakeWizard.js` needs the same
`rcsAssessmentService.recordAssessment`/`sealedRcsAssessmentId` wiring
#492 just added to `sample.service.js#createSample`. Straightforward
mirror of this session's own change, once picked up.

**#491** stays open as the tracking issue — the general "migrate backend
RCS consumers off Sample.js embedded fields" umbrella should stay open
until the real remaining consumers (MerkleService's own embedded-field
reads outside #502's scope, neo4j projection, live registration path's
remaining `Sample.js` duplication — #492 added RCS *computation* to live
registration but didn't remove `Sample.js`'s own embedded RCS field
duplication, which is a separate, still-open part of #491's scope) are
actually migrated.

**#493** (SPREC backend consumers, off #390) — 2 of 3 items done. Still
open:
- `import.service.js`'s **JSON**-import branch — needs
  `specimenPreanalyticsService.recordProfile` wiring (the CSV/XLSX
  branch already has it).
- `sampleMerkleIntegrity.js` — confirm during implementation whether
  this belongs in backend scope or the frontend follow-up (#495).

**#504** — the sealed-snapshot backfill script exists and is
unit-tested, but has not been *run* against any live environment.
Whoever next stands up a real Mongo instance with pre-#502 sample data
should run `node src/scripts/backfillSealedSnapshotPins.js` once
(idempotent, safe to re-run).

Other backlog carried forward unchanged from prior handoffs (not
re-verified this session):
- **#492's own note above (SPREC on live registration):** #492 only
  wired RCS. The live `POST /api/samples` path still doesn't call
  `specimenPreanalyticsService.recordProfile` for the `sprec` payload it
  now accepts for RCS computation — that's `SpecimenPreanalytics`'s own
  gap, likely belongs under #493's scope once picked up (not filed as a
  new issue this session — #493 already tracks the general "SPREC
  backend consumers" umbrella and this is a natural addition to its
  scope, not a distinct problem).
- **#492 design decision (design):** should live `POST /api/samples`
  registration compute RCS server-side, or accept a pre-computed
  assessment from the client? **Resolved this session** — server-side,
  reusing `qualityDomain.resolveMethodologicalQuality`. (Kept here only
  as a marker that this line item from prior handoffs is now closed —
  see #492 closure above.)
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
  closed #423). A prior session's full-suite run under `tests/unit`
  specifically saw only 2 failing files/8 failing tests, both
  independently explained (RBAC retirement series, dictionary checksum
  script) — worth a future session reconciling whether #489's original
  89-file number was a different (broader) run scope.
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

Nothing started this session. Backend-internal service logic only (not
one of the milestone's own e2e Playwright specs), so per the
`build-loop` overlay's carve-out, the proof bar was vitest against
real-query-matching in-memory fakes, not literal Docker/live Mongo. No
`docker compose up` this session, nothing to tear down.

## Which skills to use

- `work-issue` -> asked for a design recommendation first (design
  decisions aren't automatically `build-loop` material until an owner
  actually decides), then routed to `build-loop` once the decision was
  made and #492's point 3 ("is there a gap to close first?") came back
  clean — same shape as #499/#502/#503/#504: a genuinely missing
  capability (the RCS-on-registration wiring itself), not a defect
  (`fix-bugs`) or a coverage gap in already-correct code (`test-loop`).
- Before implementing a "should X reuse pattern Y" design decision,
  actually trace the target function's *current* inputs against what
  the reused pattern needs, rather than assuming the answer from
  docs/handoff notes alone — `intakeWizard.js` turned out to already be
  a half-precedent (computes but doesn't record) sitting right next to
  the code being changed, which both confirmed the design call and
  surfaced #505 as a byproduct of that trace.
- `import-lgpd.service.importSamples.unit.test.js`'s `rcsAssessments`/
  `specimenPreanalytics` collection mocks (mutate-on-insert `_id`,
  mirroring the real Mongo driver) are the reusable template for any
  future test needing to assert against `rcsAssessmentService.recordAssessment`
  or `specimenPreanalyticsService.recordProfile` — reused directly for
  this session's `sample.service.test.js` additions.
- No project board found for this repo, so boarding step was skipped —
  matches prior sessions' behavior.
