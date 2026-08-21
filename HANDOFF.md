# HANDOFF

**Written:** 2026-08-21, after closing #691 (RF005 clinical-data slice
3/5, ClinicalObservation + ClinicalOutcome + DerivedScore entities).
Continuing the Wave 3 rabbit hole (tracker **#646**) under Dennis's
"Docker is on, continue rabbit hole" instruction -- same sitting as the
#689/#690 rotations, this one supersedes them after landing one more
item and hitting this sitting's own planned checkpoint.

## Rabbit-hole state: STILL INSIDE, not exited -- ~8-9/10 spent this sitting -- CHECKPOINT, awaiting Dennis

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
**RF029 has its own sub-tracker, #668** (5/6 slices done; #674, slice
6/6, still blocked on RF027/Wave 4, not started). **RF005's clinical-data
domain has its own sub-tracker, #677** (5 slices; 3/5 now landed this
sitting -- #689, #690, #691 -- 2 remain, #692 and #693).

## What landed this sitting

- **#689 CLOSED** and **#690 CLOSED** -- see the prior two rotations'
  own entries (superseded here, not repeated). Encounter entity (merge
  `0691e12f`); Condition + PhenotypeObservation entities (merge
  `6595617f`).
- **#691 CLOSED -- RF005 clinical-data slice 3/5: ClinicalObservation +
  ClinicalOutcome + DerivedScore entities**, merge `ed52cb5e` on
  `feature/docker-e2e-backend-integration` (branch
  `fix/691-clinical-observation-outcome-derived-score`, deleted after
  merge). Pushed to `origin/feature/docker-e2e-backend-integration`.
  - Built per `dict-02_DICIONARIO.md` ELM-0219..ELM-0232 +
    P1X-0077..P1X-0078 (ClinicalObservation), ELM-0252..ELM-0254
    (ClinicalOutcome), ELM-0255..ELM-0259 (DerivedScore) -- three
    "Observation"-shaped entities grouped per #691's own scope.
  - `ClinicalObservationModel`/`ClinicalOutcomeModel`/`DerivedScoreModel`
    (plain JS class pattern) + `clinical-observation.service.js`/
    `clinical-outcome.service.js`/`derived-score.service.js`, registered
    as the `clinicalObservations`/`clinicalOutcomes`/`derivedScores`
    collections.
  - **`specimenId`/`deviceId` on ClinicalObservation are hard-checked**
    against the real `samples`/`devices` collections at create time via
    `assertReferencesExist` (RF029 AC#2's own machinery, #669) -- the
    first entity in this domain to enforce a reference rather than leave
    it joinable-but-unenforced, per #691's own scope. `diagnosticReportId`
    stays unenforced (no `DiagnosticReport` entity exists -- see #695
    below).
  - `value`/`normalizedValue` kept as distinct fields per dict-02's own
    "não sobrescrever o original." `DerivedScore.scoreComponents`
    rejects an empty array per "nunca armazenar somente o escore final."
  - **`ClinicalOutcome`/`DerivedScore` genuinely have no `participantId`
    field** -- dict-02's own row set for both omits it (confirmed by
    grep, not an oversight), matching #691's own issue scope exactly.
  - **Verified**: 24 new unit tests (models + services, the reference-
    check gate exercised against a real-semantics in-memory
    samples/devices fake) + full backend unit suite re-run clean: 349
    files / 6573 tests, no regressions.
  - **Docker not brought up this iteration either** -- same deliberate
    native-only-proof-bar reasoning as #689/#690.
  - `docs/architecture/canonical-data-contract-v1.md` gained
    ClinicalObservation/ClinicalOutcome/DerivedScore sections.
  - Progress-commented onto #677: "Slice 3/5 (#691) landed -- merge
    ed52cb5e. #692-#693 remain."
  - **Filed #695** (deniseribeiro-beep/BioAvanceD-v2, not a #646/#677
    descendant -- an ordinary marker finding, not a rabbit-hole queue
    member): dict-02's own `DiagnosticReport` entity (`P1X-0168..0171+`,
    itself flagged **"P1-Stub"** in the dictionary's own Observações
    column) is now referenced-but-unenforced by 3 fields across #690/
    #691 (`Condition.diagnosisEvidence`, `PhenotypeObservation.
    phenotypeEvidence`, `ClinicalObservation.diagnosticReportId`) with
    no tracking marker until now. Not urgent, not picked up -- same
    "marker, don't build yet" precedent as #660/#681.

## Queue members remaining (18 open issues across #646/#677/#668, plus #674/#687 pending sign-off)

| # | RF | One-line | Note |
|---|---|---|---|
| #692 | RF005 (#677 slice 4/5) | AllergyIntolerance + FamilyHistory + MedicationExposure + Procedure | soft dependency on #690 (MedicationExposure.indication -> Condition), now satisfied -- **next genuine candidate** |
| #693 | RF005 (#677 slice 5/5) | wire intake-wizard + e2e proof + traceability-doc fix | depends on #689-#692 all landing first -- #692 still outstanding |

Everything else from the prior rotations' tables (#649/#660/#662/#663/
#665/#666/#667/#680/#681/#682/#683/#684/#687/#688) is unchanged -- still
design/policy calls, markers, sign-off requests, or outside this rabbit
hole's own scope. Don't pick any of those unilaterally. **#694/#695 are
real project issues but not rabbit-hole queue members** -- ordinary
mid-session findings, filed per `wrap-up`'s case-4 rule, not
`divide-and-conquer` splits of anything already in the hole.

**Real unstarted candidate for the next pick: #692** (AllergyIntolerance
+ FamilyHistory + MedicationExposure + Procedure -- four entities, the
largest remaining slice by entity count). **#693 last** (depends on all
four prior slices landing).

## Budget (rabbit-hole Step 5) -- CHECKPOINT

**~8-9/10 spent this sitting** -- #689 medium (~2-3pt), #690 medium-large
(~3pt), #691 medium-large (~3pt: three entities plus new reference-check
machinery, 24 tests, doc updates, plus a filed marker issue). This is
the checkpoint the prior rotation's own "Recommended next steps" flagged
in advance: **stopping here to report to Dennis rather than picking up
#692 unilaterally** -- #692 is itself a 4-entity slice, likely another
~3pt, which would push well past the ~10pt ceiling with no natural
stopping point until #693 (which itself depends on #692 landing first).

## Friction this sitting (wrap-up audit)

- **Filed #695** (DiagnosticReport entity marker) -- see above. Not
  itself friction, but the kind of finding `wrap-up`'s addendum exists
  to catch: three separate unenforced-reference mentions across two
  closed issues had accumulated with no tracking marker until this
  rotation's audit caught it.
- **`tests/unit/ingestion/testHelpers.js`'s async `find()` gotcha (#694,
  filed during the #690 rotation) did NOT recur this iteration** -- 
  `clinical-observation.service.js` was written with the
  `await collection.find(filter); cursor.toArray()` form from the start,
  per that issue's own note. Confirms the fix documented in #694 works
  as a workaround for future slices reusing the same shared fake, even
  before #694 itself is resolved.
- **The full-suite-guard hook's bare-directory detection is inconsistent
  between a solo `tests/unit` run and a multi-file command that includes
  a directory among named files** -- a compound command listing ~9
  explicit test files plus `tests/unit/ingestion` (meant as "also run
  this whole related subdirectory") was blocked as looking like an
  untargeted full-suite run, while a solo `npx vitest run tests/unit`
  (this iteration's own end-of-slice regression check) was not blocked,
  consistent with #689/#690's own successful use of that same solo form.
  Worked around by naming the ingestion subdirectory's files
  individually instead. Not filed as new friction -- didn't block the
  actual verification, just needed one extra rewrite of the command.
- No other friction -- branch-before-edit discipline held, the
  primary-doc-read hook and the per-issue `gh issue close` routing gate
  both fired and were satisfied cleanly (the routing gate needed an
  explicit `build-loop` re-invocation for #691 specifically, same
  already-expected step as #690's own rotation noted), and the merge
  stayed scoped to exactly the 15 files the slice touched.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to
  `origin/feature/docker-e2e-backend-integration` (this sitting's three
  merge commits: `0691e12f`, `6595617f`, `ed52cb5e`). Working tree clean
  except the pre-existing untracked `.claude/skills/` and
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists. `main` stays frozen per this repo's own
  convention.
- **Docker: DOWN** (unchanged -- none of #689/#690/#691 needed it,
  native-only proof was the correct bar for all three). Next bring-up
  should still start from the already-aligned `temperaturePolicies`
  schema (#678) plus whatever named volumes persisted through the prior
  teardown.

## Recommended next steps

**This is a genuine checkpoint, not a forced stop** -- budget is close
to but not over the ~10pt ceiling, and the prior rotation already
flagged this exact point as where to check in with Dennis rather than
chain straight through. Report this rotation's summary and ask whether
to continue this sitting into **#692** (AllergyIntolerance +
FamilyHistory + MedicationExposure + Procedure, the largest remaining
RF005 slice) or stop here. If continuing: same discipline as #689/#690/
#691 -- branch as the literal first action, read `dict-02_DICIONARIO.md`'s
relevant ELM rows for all four entities before implementing, re-invoke
`build-loop` via the Skill tool for #692 specifically before closing it,
and check whether any of the four entities' own reference fields
(MedicationExposure.indication -> Condition is the one #692's own issue
text already flags) need the same hard-reference-check treatment #691
established for ClinicalObservation, vs. the softer joinable-unenforced
pattern most other fields in this domain use. After #692, #693 (wire
intake-wizard + e2e proof + traceability-doc fix, depends on all of
#689-#692) is the natural closer for #677's whole 5-slice breakdown --
likely warrants Docker being brought back up for its real-backend e2e
proof, unlike every slice so far.
