# HANDOFF

**Written:** 2026-08-21, after closing #692 (RF005 clinical-data slice
4/5, AllergyIntolerance + FamilyHistory + MedicationExposure +
Procedure entities). Continuing the Wave 3 rabbit hole (tracker
**#646**) under Dennis's "Docker is on, continue rabbit hole"
instruction -- same sitting as the #689/#690/#691 rotations, this one
supersedes them after landing one more item. Dennis was checkpointed
before this item (budget was already ~8-9/10) and explicitly chose to
continue into #692.

## Rabbit-hole state: STILL INSIDE, not exited -- ~11-13/10 spent this sitting, OVER the advisory ceiling -- CHECKPOINT, awaiting Dennis

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
**RF029 has its own sub-tracker, #668** (5/6 slices done; #674, slice
6/6, still blocked on RF027/Wave 4, not started). **RF005's clinical-data
domain has its own sub-tracker, #677** (5 slices; **4/5 now landed this
sitting** -- #689, #690, #691, #692 -- only #693 remains).

## What landed this sitting

- **#689, #690, #691 CLOSED** -- see the prior three rotations' own
  entries (superseded here, not repeated). Encounter (merge `0691e12f`);
  Condition + PhenotypeObservation (merge `6595617f`);
  ClinicalObservation + ClinicalOutcome + DerivedScore (merge
  `ed52cb5e`).
- **#692 CLOSED -- RF005 clinical-data slice 4/5: AllergyIntolerance +
  FamilyHistory + MedicationExposure + Procedure entities**, merge
  `ec2a0d43` on `feature/docker-e2e-backend-integration` (branch
  `fix/692-allergy-familyhistory-medicationexposure-procedure`, deleted
  after merge). Pushed to `origin/feature/docker-e2e-backend-integration`.
  - Built per `dict-02_DICIONARIO.md` ELM-0246..0248 (AllergyIntolerance),
    ELM-0249..0251 (FamilyHistory), ELM-0233..0241 (MedicationExposure),
    ELM-0242..0245 (Procedure) -- the remaining clinical-history entities
    not covered by #689-#691.
  - Four plain-JS-class models + services, registered as the
    `allergyIntolerances`/`familyHistories`/`medicationExposures`/
    `procedures` collections.
  - `MedicationExposure.indication` (-> Condition/#690) stays
    joinable-but-unenforced -- #692's own scope didn't call for a hard
    reference-check the way #691's `specimenId`/`deviceId` did, so it
    follows the default pattern most Reference fields in this domain use.
  - **All four entities genuinely have no `participantId` field** --
    confirmed by grepping dict-02's full row set for each entity name
    (not just the ELM-02xx block), same documented pattern #691 already
    established for ClinicalOutcome/DerivedScore.
  - Dropped an initially-written `getMedicationExposuresForIndication`
    query helper -- not required by the issue's own scope, and its array-
    containment filter semantics don't reproduce cleanly against this
    repo's simple exact-match test fakes; kept the service to the same
    minimal create+getById shape its three sibling services this
    iteration use, rather than build and under-test an extra feature.
  - **Verified**: 35 new unit tests + full backend unit suite re-run
    clean: 357 files / 6604 tests, no regressions.
  - **Docker not brought up this iteration either** -- same deliberate
    native-only-proof-bar reasoning as #689-#691.
  - `docs/architecture/canonical-data-contract-v1.md` gained sections
    for all four entities.
  - Progress-commented onto #677: "Slice 4/5 (#692) landed -- merge
    ec2a0d43. #693 (final slice) remains."
  - **No new friction filed this iteration** -- the first fully clean
    iteration of the sitting per `wrap-up`'s own audit: all 35 tests
    passed on the first run, scope matched exactly, no new judgment
    calls needed (the "no participantId"/"unenforced reference" patterns
    were already established by #691's precedent).

## Queue members remaining (14 open issues across #646/#677/#668, plus #674/#687 pending sign-off)

| # | RF | One-line | Note |
|---|---|---|---|
| #693 | RF005 (#677 slice 5/5, FINAL) | wire intake-wizard + real-backend e2e proof + `E2E_TRACEABILITY_PLAN.md` RF005 row fix | depends on #689-#692, all now landed -- **the only remaining #677 slice** |

Everything else from the prior rotations' tables (#649/#660/#662/#663/
#665/#666/#667/#680/#681/#682/#683/#684/#687/#688) is unchanged -- still
design/policy calls, markers, sign-off requests, or outside this rabbit
hole's own scope. Don't pick any of those unilaterally. **#694 and #695
are real project issues but not rabbit-hole queue members** -- ordinary
mid-session findings, filed per `wrap-up`'s case-4 rule.

**#693 is the only remaining candidate**, and it's a materially
different shape from #689-#692: wiring `intakeWizard.js` into all five
new entities, plus the milestone's own real-backend e2e proof (unlike
#689-#692, which all used native-only proof), plus fixing
`E2E_TRACEABILITY_PLAN.md`'s RF005 row. Likely needs Docker brought back
up, unlike every slice so far this sitting.

## Budget (rabbit-hole Step 5) -- OVER the advisory ceiling, checkpoint again

**~11-13/10 spent this sitting** -- #689 (~2-3pt), #690 (~3pt), #691
(~3pt), #692 (~3-4pt: four entities, though the smallest-scope-per-entity
slice of the four RF005 slices built so far). This sitting is now past
the ~10pt advisory ceiling Dennis was already checkpointed on before
picking up #692. **Stopping here is the right call, not a formality** --
#693 is both the largest remaining item (real e2e proof, intake-wizard
wiring across 5 entities, a doc fix) and the natural close of #677's
whole 5-slice arc, which argues for giving it a fresh sitting's full
budget rather than squeezing it in over-budget.

## Friction this sitting (wrap-up audit) -- cumulative across #689-#692

- **#694** (BioAvanceD-v2, filed during #690's rotation): `tests/unit/
  ingestion/testHelpers.js`'s shared fake makes `find()` async with no
  `.sort()` support, diverging from the real MongoDB driver and from
  `rcs-assessment.service.test.js`'s own local fake. Still open, not
  blocking -- #691/#692 both worked around it correctly from the start
  by using `const cursor = await collection.find(filter); return
  cursor.toArray();`.
- **#695** (BioAvanceD-v2, filed during #691's rotation): dict-02's own
  `DiagnosticReport` entity (`P1X-0168..0171+`, itself flagged "P1-Stub")
  is referenced-but-unenforced by 3 fields across #690/#691, with no
  tracking marker until that rotation. Still open, not urgent, not
  picked up.
- **#692's own iteration added no new friction** -- see this rotation's
  own audit entry above.
- The per-issue `gh issue close`/product-file-edit routing gate (requires
  re-invoking the routed skill, e.g. `build-loop`, via the Skill tool
  freshly for each issue number, even within one continuous sitting) held
  consistent across all four slices this sitting -- confirmed expected
  behavior, not friction, per its own error text citing dyeallpies-
  skills-pack#228/#355.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to
  `origin/feature/docker-e2e-backend-integration` (this sitting's four
  merge commits: `0691e12f`, `6595617f`, `ed52cb5e`, `ec2a0d43`). Working
  tree clean except the pre-existing untracked `.claude/skills/` and
  `api/backend/storage/assays/` (neither this sitting's doing).
- No PR to `main` exists. `main` stays frozen per this repo's own
  convention.
- **Docker: DOWN** (unchanged -- none of #689-#692 needed it, native-only
  proof was the correct bar for all four). **#693 will very likely need
  Docker brought back up** for its real-backend e2e proof requirement --
  bring it up per `docker-workflow`'s bioavanced-v2 overlay recipe when
  that slice starts, starting from the already-aligned
  `temperaturePolicies` schema (#678) plus whatever named volumes
  persisted through the prior teardown.

## Recommended next steps

**This is a genuine stopping point, not a forced one** -- 4 of #677's 5
slices landed this single sitting, budget is now past the advisory
ceiling, and #693 (the final slice) is both large and a different shape
(real e2e proof + intake-wizard wiring across all 5 entities + a
traceability-doc fix) from the pure-model-building slices #689-#692
were. Report this rotation's summary to Dennis and ask whether to
continue this sitting into #693 or stop -- don't pick it up unilaterally
given the budget is already over. If Dennis chooses to continue: #693
will need `docker-workflow`'s overlay read fresh (Docker hasn't been
brought up all sitting), the per-issue routing-gate re-invocation for
`build-loop` (or `resolve-issue`, if #693's own shape reads more like
wiring/integration than net-new capability -- worth re-classifying via
`work-issue`'s Step 2 rather than assuming `build-loop` carries over
from #689-#692), and likely a genuinely different sizing/`divide-and-
conquer` judgment call given its combined scope (5-entity wiring + e2e
spec + doc fix could itself be too big for one iteration). Once #693
closes, #677 itself closes (all 5 slices done), which is the natural
point to also re-check #646's own overall Wave 3 tracker status.
