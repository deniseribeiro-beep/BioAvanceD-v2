# HANDOFF

**Written:** 2026-08-21, after closing #690 (RF005 clinical-data slice
2/5, Condition + PhenotypeObservation entities). Continuing the Wave 3
rabbit hole (tracker **#646**) under Dennis's "Docker is on, continue
rabbit hole" instruction -- same sitting as the #689 rotation, this one
supersedes it after landing one more item.

## Rabbit-hole state: STILL INSIDE, not exited -- ~5-6/10 spent this sitting

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
**RF029 has its own sub-tracker, #668** (5/6 slices done; #674, slice
6/6, still blocked on RF027/Wave 4, not started). **RF005's clinical-data
domain has its own sub-tracker, #677** (5 slices; 2/5 now landed this
sitting -- #689 and #690 -- 3 remain).

## What landed this sitting

- **#689 CLOSED** -- see the prior rotation's own entry (superseded here,
  not repeated). Encounter entity, merge `0691e12f`.
- **#690 CLOSED -- RF005 clinical-data slice 2/5: Condition +
  PhenotypeObservation entities**, merge `6595617f` on
  `feature/docker-e2e-backend-integration` (branch
  `fix/690-condition-phenotype-observation`, deleted after merge).
  Pushed to `origin/feature/docker-e2e-backend-integration`.
  - Built per `dict-02_DICIONARIO.md` ELM-0200..ELM-0210 (Condition) +
    ELM-0211..ELM-0218 + P1X-0074..P1X-0076 (PhenotypeObservation) --
    AC4-6's own requirement text (structured coding via ORPHA/ICD-11/
    ICD-10/SNOMED/MONDO/OMIM + HPO).
  - `ConditionModel`/`PhenotypeObservationModel` (plain JS class pattern,
    `RcsAssessment`/`SpecimenPreanalytics` precedent) + `condition.
    service.js`/`phenotype-observation.service.js`, registered as the
    `conditions`/`phenotypeObservations` collections.
  - **RF005 AC#4 ("permitir codificação... somente quando houver
    ReferenceDatasetRelease ativa e validada") enforced at create time**
    by reusing `activeCodeValidator.validateActiveCodes` (RF029 AC#4's
    own machinery, #669) against every `conditionCoding`/`hpoCoding`
    entry -- a real find-and-reuse win, not reinvented. Deliberately
    does NOT go through `ingestionGateway.js`'s broader envelope
    (provenance/idempotency/quarantine) -- wiring an entity type into
    that gateway is RF029's own scope (#670-673), a distinct concern
    from RF005's own AC#4 code check. No controlled-review escape
    hatch either (unlike `ingestionGateway`'s `allowControlledReview`)
    -- AC#4 reads "somente" (only), not "unless reviewed."
  - `presenceStatus` has no default, per dict-02's own note "ausente não
    equivale a não preenchido" -- an omitted value fails validation
    outright rather than silently resolving to any of the four real
    states.
  - **Verified**: 29 new unit tests (models + services, active-code
    gating exercised against a real-semantics in-memory
    `TerminologyConcept`/`ReferenceDatasetRelease` fake) + full backend
    unit suite re-run clean: 343 files / 6546 tests, no regressions.
  - **Docker not brought up this iteration either** -- same deliberate
    native-only-proof-bar reasoning as #689 (backend-internal, non-e2e
    slice). No live caller wires these entities in yet -- deferred to
    #693 (slice 5/5).
  - `docs/architecture/canonical-data-contract-v1.md` gained Condition
    and PhenotypeObservation sections.
  - Progress-commented onto #677: "Slice 2/5 (#690) landed -- merge
    6595617f. #691-#693 remain."
  - **Filed #694** (deniseribeiro-beep/BioAvanceD-v2, not a #646/#677
    descendant -- an ordinary mid-session finding, not a rabbit-hole
    queue member): `tests/unit/ingestion/testHelpers.js`'s shared fake
    collection makes `find()` async with no `.sort()` support, diverging
    from the real MongoDB driver's sync-cursor shape and from
    `rcs-assessment.service.test.js`'s own local fake (sync `find()` +
    chainable `.sort()`). Cost this iteration: `getConditionsFor
    Participant`/`getPhenotypeObservationsForParticipant`/
    `getPhenotypeObservationsForEncounter` were first written as
    `collection.find(filter).toArray()` (the natural, real-driver-
    matching form) and needed rewriting to `const cursor = await
    collection.find(filter); return cursor.toArray();` after 5 test
    failures. Likely to recur for #691-#693, which will probably reuse
    the same shared fake for their own terminology-coded fields --
    worth checking #694's status before hitting the same wall again.

## Queue members remaining (17 open issues across #646/#677/#668, plus #674/#687 pending sign-off)

| # | RF | One-line | Note |
|---|---|---|---|
| #691 | RF005 (#677 slice 3/5) | ClinicalObservation + ClinicalOutcome + DerivedScore | soft dependency on #689 (encounterId join), now satisfied -- **next genuine candidate** |
| #692 | RF005 (#677 slice 4/5) | AllergyIntolerance + FamilyHistory + MedicationExposure + Procedure | soft dependency on #690 (MedicationExposure.indication -> Condition), now satisfied |
| #693 | RF005 (#677 slice 5/5) | wire intake-wizard + e2e proof + traceability-doc fix | depends on #689-#692 all landing first -- #691/#692 still outstanding |

Everything else from the prior rotations' tables (#649/#660/#662/#663/
#665/#666/#667/#680/#681/#682/#683/#684/#687/#688) is unchanged -- still
design/policy calls, markers, sign-off requests, or outside this rabbit
hole's own scope. Don't pick any of those unilaterally. **#694 is a real
project issue but not a rabbit-hole queue member** -- an ordinary
mid-session finding, filed per `wrap-up`'s case-4 rule, not a
`divide-and-conquer` split of anything already in the hole.

**Real unstarted candidate for the next pick: #691** (ClinicalObservation
+ ClinicalOutcome + DerivedScore). **#692 after it, #693 last** (depends
on all four prior slices).

## Budget (rabbit-hole Step 5)

**~5-6/10 spent this sitting** -- #689 medium (~2-3pt), #690 medium-large
(~3pt: two entities, real terminology-governance gating logic reused
from RF029, 29 tests, doc updates, plus a filed follow-up issue).
Approaching the midpoint of the ~10pt ceiling -- room for one more
similar-sized slice (#691) this sitting, but worth checking in with
Dennis after it rather than chaining straight through to #692/#693
without a checkpoint.

## Friction this sitting (wrap-up audit)

- **`tests/unit/ingestion/testHelpers.js`'s async `find()` API mismatch**
  -- filed #694 (BioAvanceD-v2), not a rabbit-hole queue member. See
  above for the full description; the practical takeaway for #691-#693:
  if reusing this shared fake, write `const cursor = await
  collection.find(filter); return cursor.toArray();`, not the
  more-natural chained `collection.find(filter).toArray()`, until #694
  is resolved.
- **`collections.test.js`'s `toEqual(DEFAULTS)` exact-object-equality
  gotcha recurred** -- same friction the #689 rotation already noted;
  #690 added two more collection keys (`conditions`,
  `phenotypeObservations`) and both `DEFAULTS` blocks needed updating
  again. Not re-filed as new friction (same known shape, not a fresh
  discovery) -- just confirming it'll keep recurring for #691/#692's own
  new collections too.
- **The `gh issue close`/`gh issue edit` routing gate is scoped per-issue,
  not per-session** -- closing #690 was blocked until `build-loop` was
  explicitly re-invoked via the Skill tool for #690 specifically, even
  though this same iteration had already been following build-loop's
  process throughout (just without a fresh per-issue Skill call). The
  gate's own error text cited this as known, already-tracked behavior
  (dyeallpies-skills-pack#228/#355) -- not new friction, just a reminder
  to make the explicit re-invocation call for #691/#692/#693 too, not
  assume the earlier #689/#690 invocations carry over.
- No other friction -- branch-before-edit discipline held (branch
  created as the literal first action for #690, same as #689), the
  primary-doc-read hook fired and was satisfied cleanly, and the merge
  stayed scoped to exactly the 11 files the slice touched (confirmed via
  `git status`/the merge's own `--stat` output).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to
  `origin/feature/docker-e2e-backend-integration` (this sitting's two
  merge commits, `0691e12f` and `6595617f`). Working tree clean except
  the pre-existing untracked `.claude/skills/` and
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists. `main` stays frozen per this repo's own
  convention.
- **Docker: DOWN** (unchanged -- neither #689 nor #690 needed it, native-
  only proof was the correct bar for both). Next bring-up should still
  start from the already-aligned `temperaturePolicies` schema (#678)
  plus whatever named volumes persisted through the prior teardown.

## Recommended next steps

Dennis said "continue rabbit hole" -- this rotation is a mid-sitting
checkpoint (per rabbit-hole Step 4's "every item gets its own handoff"
rule), not a stopping point. **Next pick: #691** (ClinicalObservation +
ClinicalOutcome + DerivedScore, RF005 slice 3/5) unless Dennis redirects.
Same discipline as #689/#690: create the per-issue branch as the literal
first action, read `dict-02_DICIONARIO.md`'s relevant ELM rows and
cross-check `requisitos-index.md`'s RF005 AC4-6 before implementing, and
explicitly re-invoke the routed skill (`build-loop`) via the Skill tool
for #691 specifically before closing it (the gate is per-issue, per this
rotation's own friction note above). Check whether #691's own coding
fields need the same `activeCodeValidator` reuse #690 established, and if
reusing `tests/unit/ingestion/testHelpers.js`'s shared fake, use the
`await collection.find(filter)` form per #694's note above. After #691,
check in with Dennis before continuing to #692/#693 -- budget will be
close to the ~10pt ceiling by then.
