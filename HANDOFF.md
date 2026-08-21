# HANDOFF

**Written:** 2026-08-21, after closing #693 (RF005 clinical-data slice
5/5, chunked) and #677 (the tracking issue -- all 5 slices done).
Wave 3 rabbit hole (tracker **#646**) sitting under Dennis's "Docker is
on, continue rabbit hole" instruction. This rotation supersedes the
#689/#690/#691/#692 rotations, all landed in this same sitting.

## Rabbit-hole state: STILL INSIDE #646 (not exited), but #677's own sub-thread is CLOSED -- ~15-18/10 spent this sitting -- STOP HERE, recommend a fresh sitting next

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
**RF005's clinical-data domain (#677) is now fully done** -- all 5 slices
(#689-#693) landed and merged this single sitting. **RF029 still has its
own sub-tracker, #668** (5/6 slices done; #674, slice 6/6, still blocked
on RF027/Wave 4, not started) -- unchanged this sitting.

## What landed this sitting (full arc, 5 issues closed)

- **#689 CLOSED** -- Encounter entity (merge `0691e12f`). See prior
  rotation, not repeated.
- **#690 CLOSED** -- Condition + PhenotypeObservation entities (merge
  `6595617f`). See prior rotation.
- **#691 CLOSED** -- ClinicalObservation + ClinicalOutcome + DerivedScore
  entities (merge `ed52cb5e`). See prior rotation.
- **#692 CLOSED** -- AllergyIntolerance + FamilyHistory +
  MedicationExposure + Procedure entities (merge `ec2a0d43`). See prior
  rotation.
- **#693 CLOSED (chunked, per divide-and-conquer, confirmed with Dennis
  before splitting)** -- merge `c4c98e0d` on
  `feature/docker-e2e-backend-integration` (branch
  `fix/693-intake-wizard-clinical-entities-e2e`, deleted after merge).
  - **Re-scoped out loud before starting**: #693 as filed bundled 3
    different-sized deliverables (wiring, a real Playwright e2e spec,
    a doc fix) across 10 entities, but only 4 (`Encounter`, `Condition`,
    `PhenotypeObservation`, `MedicationExposure`) have real source data
    in today's intake-wizard payload -- the other 6 would need new UI
    fields or (for `DerivedScore`) a real Charlson-scoring algorithm,
    not just a data mapping. **Confirmed the chunking plan with Dennis
    via AskUserQuestion before filing anything**, per
    `divide-and-conquer`'s own required step.
  - **Landed**: `intakeWizard.js`'s new `recordClinicalEntities()`
    additively creates real `Encounter`/`Condition`/
    `PhenotypeObservation`/`MedicationExposure` documents from data the
    wizard already collects (`diagnosis.orphaCode/omimCode/icdCode` ->
    Condition; `clinical.diseasePhenotypes[]` -> one PhenotypeObservation
    per entry, HPO-coded; `pharmacologyData` -> MedicationExposure when
    both `medicationName` and `atcCode` are present). RF005 AC#4's
    active-release gate is enforced for real on every coded field
    (`activeCodeValidator`, reused from RF029/#669) -- an
    inactive/unknown code is silently skipped, not persisted, and
    doesn't fail the submission (this wizard already tolerates
    manually-entered codes with no reference-catalog match today).
    Every write is best-effort, same non-fatal precedent #505's
    `RcsAssessment` recording already established for this handler.
    `Sample.clinicalData`/`pharmacologyData` (the existing embedded
    subdocument) is untouched -- additive, not a replacement.
  - **Filed #696**: the literal real-backend Playwright e2e proof
    #693's own scope called for -- needs Docker (first RF005 slice
    that does) + investigating/seeding real terminology fixture data.
  - **Filed #697**: wiring the remaining 6 entities -- a marker, blocked
    on new intake-wizard UI (5 entities) or a real Charlson-scoring
    algorithm (`DerivedScore`), not urgent, not picked up.
  - **Verified**: 5 new tests in
    `tests/unit/intakeWizard.clinicalEntities.test.js` (native-only,
    real-semantics fakes for `terminologyConcepts`/
    `referenceDatasetReleases` + the 4 new collections, including a case
    proving an inactive/unknown code is skipped without failing the
    intake) + all 4 existing `intakeWizard.*.test.js` files re-verified
    green together (68 tests) + full backend unit suite: 358 files /
    6609 tests, no regressions.
  - `E2E_TRACEABILITY_PLAN.md`'s RF005 row updated (was stale on both
    the AC1-3 status-description half and the AC4-6 not-built half).
    `docs/architecture/canonical-data-contract-v1.md` updated across
    every entity section this wiring touched.
  - **Filed dyeallpies-skills-pack#370**: a real, non-obvious test-
    mocking gotcha -- a service module that destructures
    `const { getCollection } = require('../utils/collectionResolver')`
    at its own top level, if never explicitly cleared from
    `require.cache` between tests in the same file, keeps whichever
    mock was live the *first* time it was ever loaded, silently ignoring
    later tests' property-reassignment mocks. Symptom: passes in
    isolation, fails when the file's full suite runs together -- looks
    like flaky/order-dependent behavior, isn't. Cost several debug
    cycles this iteration; fixed locally (added the new services to the
    test file's own `allPaths`/`clearCache()` list) and filed as a
    `vitest-specs` lesson for the pack, since the underlying JS
    mechanism is general, not specific to this one test file.
  - Progress-commented onto #677: "Slice 5/5 (#693, chunked) landed."
  - **#677 CLOSED** (the RF005 5-slice tracking issue) -- all 5 slices
    done, closing comment names all 5 merge hashes plus #696/#697 as
    non-blocking follow-ups.
  - **Progress-commented onto #646** (the top-level Wave 3 tracker):
    #677 closed, #696/#697 are new queue members from #693's own
    chunking (direct descendants of something already in the hole, per
    `rabbit-hole`'s own scope rule).

## Queue members remaining in #646 (16 open issues, plus #674/#687 pending sign-off)

RF005's clinical-data thread is done. New members from this sitting:
**#696** (real-backend Playwright e2e proof for the 4 wired entities --
needs Docker) and **#697** (marker: wiring the remaining 6 entities,
blocked on new UI/algorithm work, not picked up). Everything else
unchanged from prior rotations' tables (#649/#660/#662/#663/#665/#666/
#667/#680/#681/#682/#683/#684/#687/#688) -- still design/policy calls,
markers, sign-off requests, or outside this rabbit hole's own scope.
**#694/#695** (filed during #690/#691's rotations) are real project
issues, still open, not rabbit-hole queue members (ordinary mid-session
findings). Don't pick any of the parked items unilaterally.

**Real candidates for the next pick**: **#696** (needs Docker + fixture
investigation, a genuinely different shape from everything built this
sitting) or **#674** (RF029 slice 6/6, still blocked on RF027/Wave 4 --
check whether that's unblocked before picking). Both deserve a fresh
sitting's own full budget, not a continuation of this one.

## Budget (rabbit-hole Step 5) -- deeply over the advisory ceiling

**~15-18/10 spent this sitting** -- five landed items (#689 ~2-3pt, #690
~3pt, #691 ~3pt, #692 ~3-4pt, #693 ~4-5pt including the chunking
decision + debugging the require-cache test gotcha) across a single
continuous sitting, roughly 1.5-2x the ~10pt advisory ceiling. Dennis
was checkpointed twice mid-sitting (after #691, after #692) and chose to
continue both times; #693 additionally got its own explicit chunking
confirmation. **This is the natural stopping point** -- RF005's entire
5-slice arc is done and closed, which is a complete, coherent unit of
work to end on, not an arbitrary interruption.

## Friction this sitting (wrap-up audit) -- cumulative across #689-#693

- **#694** (BioAvanceD-v2, still open): `tests/unit/ingestion/
  testHelpers.js`'s shared fake makes `find()` async with no `.sort()`
  support, diverging from the real MongoDB driver. Not blocking --
  every slice after #690 worked around it correctly.
- **#695** (BioAvanceD-v2, still open): dict-02's own `DiagnosticReport`
  entity ("P1-Stub") referenced-but-unenforced by 3 fields, no build
  planned, just a marker.
- **dyeallpies-skills-pack#370** (pack tracker, filed this rotation):
  the destructured-require mock-staleness gotcha in `intakeWizard.*.
  test.js`-family tests -- see above, fixed locally, filed as a durable
  `vitest-specs` lesson for the pack.
- The per-issue `gh issue close`/product-file-edit routing gate held
  consistent across all five slices this sitting (needs a fresh
  `build-loop` Skill-tool re-invocation per issue number, even
  mid-sitting) -- confirmed expected behavior throughout, not friction.
- No other friction this sitting beyond what's captured above and in
  the prior four rotations' own entries.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to
  `origin/feature/docker-e2e-backend-integration` (this sitting's five
  merge commits: `0691e12f`, `6595617f`, `ed52cb5e`, `ec2a0d43`,
  `c4c98e0d`). Working tree clean except the pre-existing untracked
  `.claude/skills/` and `api/backend/storage/assays/` (neither this
  sitting's doing).
- No PR to `main` exists. `main` stays frozen per this repo's own
  convention.
- **Docker: DOWN** (unchanged all sitting -- none of #689-#693 needed
  it, native-only proof was the correct bar for all five). **#696 will
  need Docker brought back up** -- the first RF005 slice with a literal
  real-backend Playwright proof requirement. Bring it up per
  `docker-workflow`'s bioavanced-v2 overlay recipe when that issue
  starts, starting from the already-aligned `temperaturePolicies` schema
  (#678) plus whatever named volumes persisted through the prior
  teardown.

## Recommended next steps

**Stop here.** RF005's entire clinical-data domain (#677, all 5 slices)
is done and closed in one continuous sitting -- a complete, coherent
deliverable, and budget is deeply past its own advisory ceiling. Next
sitting: **#696** (real-backend Playwright e2e proof, needs Docker +
terminology fixture investigation) is the natural next pick if
continuing RF005's own thread, or **#674**/other #646 queue members if
picking a different thread. Read `docker-workflow`'s overlay fresh
before #696's first Docker command (hasn't been brought up all this
sitting). Same discipline as every slice this sitting: branch first,
`dict-02_DICIONARIO.md`/`requisitos-index.md` as primary sources,
re-invoke the routed skill via the Skill tool per issue number before
closing. If reusing `tests/unit/ingestion/testHelpers.js`'s shared fake
in a future slice, see #694's note; if writing a new test file that
mocks `collectionResolver.getCollection` while exercising code that
transitively requires other service modules, see dyeallpies-skills-
pack#370's note about clearing those modules from `require.cache` too.
