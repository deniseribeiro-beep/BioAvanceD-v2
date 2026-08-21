# HANDOFF

**Written:** 2026-08-21, continuing the same rabbit hole under Dennis's
repeated "Keep descending" / "Next slice" instructions this sitting.
Docker is on.

## Rabbit-hole state: STILL INSIDE #646 -> #707 -- 3/6 sub-slices landed (#708, #709, #710), 3 remain (#711-713)

**Tracker: #646** (Wave 3 kickoff) -> **#707** (RF005: wire remaining 6
clinical-data entities into real intake-wizard UI + a real CCI
algorithm).

This sitting picked up and landed three sub-slices via `build-loop`,
back to back:

- **#708 (AllergyIntolerance):** manual-entry allergen field (name +
  DCB code + reaction). Merged `b4889219`.
- **#709 (FamilyHistory):** manual-entry family-history field
  (relationship select + condition name + ORPHA code + onset). Merged
  `fdfe6349`.
- **#710 (Procedure):** manual-entry procedure field (name + code +
  required performed date + optional body-site text), coded against a
  newly-invented local system URI
  (`urn:biobank:local-procedure-terminology`, since no SNOMED importer
  exists here). Merged `d61993e2`.

All three followed the identical shape: `clinicalDataSchema` gained the
new array field, `buildClinicalData`/`recordClinicalEntities` wired it
additively (best-effort, never fails the intake), 2 new native-only
unit cases each in `intakeWizard.clinicalEntities.test.js`, and #696's
real-backend Playwright spec
(`tests/e2e/intake-wizard.spec.ts`'s "Clinical-entity wiring" describe
block) extended once per slice to submit+assert the new entity
alongside the others from one live submission. All three merged,
closed, progress-commented on #707 (1/6 -> 2/6 -> 3/6).

**Known gap, flagged not fixed (all three slices):** none of
`allergy-intolerance.service.js`/`family-history.service.js`/
`procedure.service.js` gates its coded field on `activeCodeValidator`
(RF005 AC#4) -- pre-existing since #692, not added here to keep each
slice scoped to "UI + wiring." All three now tracked on
[**#714**](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/714)
(one issue, three follow-up comments, not three duplicates) --
Procedure's comment flags a real nuance: its code comes from a locally-
invented system URI, not a real RF028-imported `ReferenceDatasetRelease`,
so `activeCodeValidator`'s existing gate mechanism may not directly
apply to it the way it would for the other two.

## What landed this sitting

- 3 merge commits (`b4889219`, `fdfe6349`, `d61993e2`) on
  `feature/docker-e2e-backend-integration`.
- #708, #709, #710 closed. #707 progress-commented three times (1/6,
  2/6, 3/6).
- **#714** filed (originally AllergyIntolerance-scoped), broadened via
  two follow-up comments to cover FamilyHistory and Procedure's
  identical gaps too.
- **Friction found and filed (skills-pack, not this repo's tracker):**
  a transient post-Docker-rebuild Playwright flakiness hit during the
  #709 slice (two failures that looked like real regressions, resolved
  on retry with zero code changes) -- filed as
  [dyeallpies-skills-pack#377](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/377).
  Did **not** recur during #710's verification (ran clean twice in a
  row on the first try after that slice's rebuild) -- consistent with
  #377's framing as an intermittent cold-start issue, not a systemic one.
- The `resolve-issue` pre-close routing gate needed a fresh invocation
  immediately before each `gh issue close` call, all three times -- an
  intervening `gh issue view <N> --json state` (itself required by
  `resolve-issue`'s own "check state before closing" instruction)
  un-satisfies the gate. Mechanical, cost extra Skill calls, didn't
  block anything. Not re-filed as new friction (already reported after
  #709; same shape recurred, no new information).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `d61993e2`. All three per-issue branches (`test/708-...`,
  `test/709-...`, `test/710-...`) were merged `--no-ff` and deleted
  locally (none was ever pushed remotely).
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- **Docker: UP.** `backend-app-test`/`frontend-app-test` rebuilt with
  `--build` three times this sitting (once per slice) to pick up source
  changes; `playwright-runner` stopped before each manual run, left
  stopped. Stack left running for the next #707 pickup.

## Recommended next steps

**#707's 3 remaining sub-slices (#711-713) are the live, unblocked
queue** -- but unlike #708-710, these are explicitly the larger/
different-shaped ones flagged since #707 was filed:
- #711 ClinicalObservation intake-wizard UI + wiring (genuinely new UI,
  no existing field to repurpose)
- #712 ClinicalOutcome intake-wizard UI + wiring (genuinely new UI --
  longitudinal progression/remission/relapse tracking, a different
  shape from the simple add-a-record pattern #708-710 used)
- #713 real CCI algorithm + `DerivedScore` wiring (a genuinely different
  shape from all 5 UI-wiring slices -- an actual weighted scoring
  algorithm over the wizard's existing `charlsonConditions` field, not
  a new form section)

No slice depends on another; pick any. Given #711/#712 need real new UI
design (not just "another add-a-record section" like the last three)
and #713 needs an actual algorithm, expect the next slice to take
meaningfully longer than #708-710 did.

**New, separate from #707:** #714 (three entities' missing RF005 AC#4
gate, one with a real design nuance for Procedure specifically) --
ordinary backlog, not part of #707's queue.

#674 stays parked on RF027 (Wave 4, not started, out of scope) -- unless
Dennis pulls it forward, untouched.

Rabbit-hole budget: this sitting spent ~9pts (three full build-loop
slices, each new UI + backend wiring + schema + 2 unit tests + 1
extended e2e spec + 2 docs + issue filing/broadening, plus one skills-
pack friction report). Cumulative total was already well past the
~10pt advisory budget before this sitting started, and is now further
past it. 3 more slices remain (#711-713), explicitly the larger ones --
worth another explicit check-in with Dennis before continuing, same as
the last two rotations, and worth noting the next slice is a step up in
size from the last three.
