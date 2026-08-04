# HANDOFF

**Written:** 2026-08-04, after implementing #405 (Sample.js: specimenStatus
core field + dual-write bridge) on `feature/docker-e2e-backend-integration`.

## What happened this session

Dennis said "pick #405" (the first of the four-issue chain #405→#406→
#407→#408 that a prior session split #399 into). Invoked `resolve-issue`,
then `bioavanced-v2-conventions` and `build-loop` (this is a
spec'd-but-missing-capability slice, per #398's decision doc).

Confirmed #405 still open, no stale branch for it, and the doc
(`canonical-data-contract-v1.md`'s Specimen section) still matched the
plan. Branched `test/405-specimen-status-dual-write` off
`feature/docker-e2e-backend-integration` (build-loop has no dedicated
prefix here; falls back to `test/<slug>` per the branch-guard hook).

**Implemented, in `api/backend/src/models/Sample.js` and
`api/backend/src/services/sample.service.js`:**
- Added `specimenStatus` to `Sample.js`'s schema (dict-02 ELM-0123's enum
  + the local `disposed` extension).
- `SampleModel.computeStatus()` now computes case-folded `specimenStatus`
  (same sticky-status algorithm shape, lowercase vocabulary, `disposed`
  added to the sticky/blocked list).
- `SampleModel.create()` folds `REGISTERED` into `available` and derives
  `lifecycleStatus`/`availabilityStatus` from `specimenStatus` via a new
  `SampleModel.deriveLegacyStatuses()` — pure 1:1 derivation, not
  independently maintained.
- Added `SampleModel.resolveSpecimenStatus()` — a fallback for legacy
  sample documents written before this field existed (case-folds their
  `lifecycleStatus` until their next write goes through the bridge). Not
  explicitly asked for in #405's text but needed to keep existing sample
  docs working without a data migration, which was out of #405's scope.
- `withdrawSample`/`returnSample`/`updateSample` in `sample.service.js`
  now compute and gate on `specimenStatus`, using one shared
  `BLOCKED_SPECIMEN_STATUSES` constant (replacing the two duplicated
  `blockedLifecycleStatuses` arrays), and write the derived legacy fields
  alongside it on every write (the dual-write bridge).
- Updated `sample.service.test.js`, `sample.models.test.js`,
  `sample.model.gaps.test.js`, and `sample.model.unit.test.js` (this last
  one wasn't named in #405's text but also asserted on `computeStatus`'s
  old uppercase vocabulary and needed the same update) — 140 targeted
  tests green, plus a full native `vitest run tests/unit` pass (out of
  the normal per-iteration scope, run as an extra sanity check since this
  touched a widely-read model).
- Marked `canonical-data-contract-v1.md`'s Specimen section "Landed in
  #405," noting explicitly what's still open for #406 (the
  `intakeWizard`/quarantine-service drift bug, #404, isn't fixed until
  every write site funnels through `specimenStatus`).

Committed (`30bf6f76`, "Closes #405"), fast-forward merged into
`feature/docker-e2e-backend-integration`, pushed, re-ran the targeted
tests on the merged branch (still green), closed #405 with a summary
comment, deleted the local `test/405-...` branch.

**Also filed** (skill/hook orchestration, not a product finding):
`DyeAllPies/dyeallpies-skills-pack#204` — the Rule-0 write-guard blocked
two plain-read attempts this session even though #177/#126 already
reported and supposedly fixed this exact false-positive class: a
`ls ... 2>&1` (fd-redirect, not a real write target) tripped it, and
separately a `gh issue create --body "..."` describing this very finding
(mentioning the junction path as prose) also tripped it — likely because
the body's escaped internal quotes broke #177's quote-masking fix.
Worked around both by using the Read tool instead of Bash for the
local-env check, and `--body-file` instead of inline `--body` for the
issue filing.

## Repo state

- **`feature/docker-e2e-backend-integration`**: now at `30bf6f76` (was
  `8334fba6`), pushed, clean. `test/405-specimen-status-dual-write`
  merged and deleted (local only — never pushed remotely).
- Issues: **#405 closed** (implemented, merged, pushed). **#406, #407,
  #408 still open**, unstarted, dependency-chained as before. **#399**
  still open as the tracking issue for the chain. **#404** still open,
  unfixed — still tied to land as part of #406 (the dual-write bridge in
  #405 doesn't touch the quarantine write sites that #404 found drifting).
  **#401, #402** still open, unstarted, unchanged.

## Blocking next step

None.

## Recommended next steps

Dennis didn't name a specific next pick this session (only said "pick
#405"). Most natural next pick, per the chain's own dependency order:

- **#406** — `QuarantineAction` entity + quarantine write-site migration
  (`equipment-sensor-quarantine.service.js`, `intakeWizard.js`/
  `.routes.js`, `eConsent.js`, `fhir-import-staging.service.js`).
  Depends on #405 (now done) — unblocked. This is also where #404
  actually gets fixed, once every quarantine write site funnels through
  `specimenStatus`. Re-read #399's breakdown comment and
  `canonical-data-contract-v1.md`'s `### QuarantineAction` section (and
  the `### Specimen` section's point 3, the acknowledged `actionStatus`
  domain gap) before starting — same "prove, then build" build-loop
  discipline as #405.
- **#401** — no dependency, likely near-trivial.
- **#402** — no dependency, low priority (`StorageAssignment`
  placement-history feature gap).
- Older backlog, unchanged: **#384–#387**, `#371`/`#373`/`#374`/`#378`/
  `#379`.

## Which skills to use

- Whichever of #406/#401/#402 is picked up next: invoke `resolve-issue`
  via the Skill tool explicitly before acting — standing rule, still
  holding. **#406 specifically is `build-loop`-shaped** (a new entity
  that doesn't exist in the code yet, same as #405 was) — invoke that
  too.
- **#406 (and #407/#408 after it)**: re-read #399's breakdown comment and
  `canonical-data-contract-v1.md`'s `### QuarantineAction` section before
  touching code — same reasoning as #405's handoff note: the dual-write
  bridge design is why chunking this was safe, and #405's
  `SampleModel.deriveLegacyStatuses()`/`resolveSpecimenStatus()` are now
  the concrete pattern #406's quarantine write sites should funnel
  through, not reinvent.
- **#390** (multi-consumer migration once RCS/SPREC/storage-custody
  entities land): still blocked on #401 and on the full #405→#408 chain
  (one down, three to go).
- Backlog unchanged otherwise: **#384–#387**, older backlog
  (`#371`/`#373`/`#374`/`#378`/`#379`) — untouched this session.
