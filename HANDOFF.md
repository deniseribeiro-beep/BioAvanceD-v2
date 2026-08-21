# HANDOFF

**Written:** 2026-08-21, after closing #689 (RF005 clinical-data slice
1/5, Encounter entity). Continuing the Wave 3 rabbit hole (tracker
**#646**) under Dennis's "Docker is on, continue rabbit hole"
instruction, a new sitting following the prior rotation
(`d4bc9afe`/`ce803200`) whose own checkpoint asked whether to continue
into #689 — Dennis picked it up this sitting.

## Rabbit-hole state: STILL INSIDE, not exited -- ~2-3/10 spent this sitting

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
**RF029 has its own sub-tracker, #668** (5/6 slices done; #674, slice
6/6, still blocked on RF027/Wave 4, not started). **RF005's clinical-data
domain has its own sub-tracker, #677** (5 slices; slice 1/5 now landed
this sitting, 4 remain).

## What landed this sitting

- **#689 CLOSED -- RF005 clinical-data slice 1/5: Encounter entity**,
  merge `0691e12f` on `feature/docker-e2e-backend-integration` (branch
  `fix/689-encounter-entity`, deleted after merge). Pushed to
  `origin/feature/docker-e2e-backend-integration`.
  - Built per `dict-02_DICIONARIO.md` ELM-0194..ELM-0199 (domain "Dados
    clínicos"), cross-checked against `requisitos-index.md`'s RF005
    entry (the hook-enforced primary-doc read) -- RF005's own AC list
    doesn't name Encounter directly (AC4-6 are the terminology-coding
    ACs for later slices), confirming this slice is genuinely
    foundational infrastructure, not something the primary doc
    contradicts.
  - `EncounterModel` (plain JS class, `src/models/Encounter.js`) follows
    the `RcsAssessment`/`SpecimenPreanalytics` referenced-entity pattern
    (#383/#388), not an embedded field -- `encounterId` generated via
    `crypto.randomUUID()` same as `PatientConsentModel.consentId`/
    `QuarantineActionModel.quarantineActionId`. `encounterType`
    (CodeableConcept) stored as given, same "not forced into one shape"
    precedent `QuarantineAction.reasonCodes` uses. `encounterPeriod`
    uses the `{start, end: null-means-open-ended}` shape
    `TemperaturePolicy.effectivePeriod` already established.
  - `encounter.service.js`: `createEncounter`/`getEncountersForParticipant`/
    `getEncounterById`, registered as the `encounters` collection in
    `config/collections.js` (`collections.test.js` updated for the new
    key -- its `toEqual(DEFAULTS)` assertions needed both DEFAULTS
    objects extended, a real gotcha since it's a full-object-equality
    check, not additive).
  - **Verified**: 15 new unit tests (model validation/defaults + service
    query-matching against a real-semantics in-memory collection fake,
    not a canned stub) + full backend unit suite re-run clean: 339 files
    / 6521 tests, no regressions.
  - **Docker not brought up this iteration** -- deliberate, per
    `build-loop`'s BioAvanceD-v2 overlay: this is a backend-internal,
    non-e2e slice, so the native-only in-memory-mock proof bar applies
    (literal Docker/live-DB stays reserved for the milestone's own e2e
    Playwright specs). No live caller wires this entity in yet --
    intentional, deferred to #693 (slice 5/5) alongside the
    intake-wizard integration and real-backend e2e proof.
  - `docs/architecture/canonical-data-contract-v1.md` gained an
    Encounter section (inserted between SpecimenPreanalytics and
    Consent) documenting the fields, what's landed, and what's
    deliberately deferred to #693 -- per `build-loop`'s "update the doc
    a slice touches, same commit" step.
  - Progress-commented onto #677 (the slice tracker): "Slice 1/5 (#689)
    landed -- merge 0691e12f. #690-#693 remain."

## Queue members remaining (17 open issues across #646/#677/#668, plus #674/#687 pending sign-off)

Unchanged from the prior rotation except #689 closed and #690 now has no
remaining soft blocker of its own kind (its dependency, #689, landed).
Full table not re-copied here -- see this file's own git history
(`ce803200`) for the complete list; the only rows that changed:

| # | RF | One-line | Note |
|---|---|---|---|
| #689 | RF005 (#677 slice 1/5) | Encounter entity | **CLOSED this sitting, merge 0691e12f** |
| #690 | RF005 (#677 slice 2/5) | Condition + PhenotypeObservation | soft dependency on #689 now satisfied -- **next genuine candidate** |
| #691 | RF005 (#677 slice 3/5) | ClinicalObservation + ClinicalOutcome + DerivedScore | same soft dependency on #689, now satisfied |
| #692 | RF005 (#677 slice 4/5) | AllergyIntolerance + FamilyHistory + MedicationExposure + Procedure | soft dependency on #690 (MedicationExposure.indication -> Condition) |
| #693 | RF005 (#677 slice 5/5) | wire intake-wizard + e2e proof + traceability-doc fix | depends on #689-#692 all landing first |

Everything else in the prior rotation's table (#649/#660/#662/#663/#665/
#666/#667/#680/#681/#682/#683/#684/#687/#688) is unchanged -- still
design/policy calls, markers, sign-off requests, or outside this rabbit
hole's own scope. Don't pick any of those unilaterally.

**Real unstarted candidate for the next pick: #690** (Condition +
PhenotypeObservation -- AC4-6's core terminology-coded diagnostic path,
HPO/ORPHA/CID/MONDO/OMIM). Larger than #689 (two entities, terminology-
coding validation against `ReferenceDatasetRelease`), likely a
medium-large slice. **#691-#693 in order after it.**

## Budget (rabbit-hole Step 5)

**~2-3/10 spent this sitting** -- #689 was medium (~2-3pt: new entity +
service + collection wiring + doc update + 15 tests + full-suite
re-verification, no Docker needed). Well under the ~10pt ceiling --
room to continue into #690 this same sitting if Dennis wants to keep
going.

## Friction this sitting (wrap-up audit)

- **`collections.test.js`'s `toEqual(DEFAULTS)` assertions are exact-
  object-equality, not additive** -- adding a new `CANONICAL_COLLECTIONS`
  key without updating both `DEFAULTS` blocks in that test file fails
  immediately. Caught before commit by running the test, not a real
  incident, but worth remembering for the next new-collection slice
  (#690-#693 will each likely add one).
- No other friction -- the branch-before-edit discipline held this time
  (branch created as the literal first action, per the prior rotation's
  explicit reminder and dyeallpies-skills-pack#369), the primary-doc-read
  hook fired correctly and was satisfied before the blocked edit retried
  clean, and the merge stayed scoped to exactly the 7 files the slice
  touched (confirmed via the merge's own `--stat` output).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to
  `origin/feature/docker-e2e-backend-integration` (this sitting's one
  merge commit, `0691e12f`). Working tree clean except the pre-existing
  untracked `.claude/skills/` and `api/backend/storage/assays/` (neither
  this sitting's doing).
- No PR to `main` exists. `main` stays frozen per this repo's own
  convention.
- **Docker: DOWN** (unchanged from the prior rotation -- this sitting's
  slice didn't need it, native-only proof was the correct bar). Next
  bring-up should still start from the already-aligned
  `temperaturePolicies` schema (#678) plus whatever named volumes
  persisted through the prior teardown.

## Recommended next steps

Dennis said "continue rabbit hole" -- this rotation is a mid-sitting
checkpoint (per rabbit-hole Step 4's "every item gets its own handoff"
rule), not a stopping point. **Next pick: #690** (Condition +
PhenotypeObservation, RF005 slice 2/5, its soft dependency on #689 now
satisfied) unless Dennis redirects. Same discipline as this iteration:
create the per-issue branch as the literal first action, read
`dict-02_DICIONARIO.md`'s Condition/PhenotypeObservation rows (ELM-0200+)
and cross-check `requisitos-index.md`'s RF005 AC4-6 (terminology coding
via HPO/ORPHA/CID/MONDO/OMIM, gated on an active/validated
`ReferenceDatasetRelease`) before implementing -- this slice is likely
the first of the five to actually touch that gating logic, unlike #689's
plain foundational entity. Bring Docker up only if #690 turns out to need
live-backend proof beyond the native-only in-memory-mock bar (e.g. if it
ends up wiring a real caller) -- default to the same native-only bar
#689 used otherwise, per the overlay's explicit carve-out.
