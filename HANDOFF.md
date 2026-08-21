# HANDOFF

**Written:** 2026-08-21, continuing the same rabbit hole under Dennis's
"Keep descending" / "Next slice" instructions this sitting. Docker is on.

## Rabbit-hole state: STILL INSIDE #646 -> #707 -- 2/6 sub-slices landed (#708, #709), 4 remain (#710-713)

**Tracker: #646** (Wave 3 kickoff) -> **#707** (RF005: wire remaining 6
clinical-data entities into real intake-wizard UI + a real CCI
algorithm).

This sitting picked up and landed two sub-slices via `build-loop`, back
to back:

**#708 (AllergyIntolerance):** manual-entry allergen field (name + DCB
code + reaction) added to the wizard; `recordClinicalEntities`
additively creates a real DCB-coded `AllergyIntolerance` per entry.
Merged at `b4889219`.

**#709 (FamilyHistory):** manual-entry family-history field
(relationship select + condition name + ORPHA code + onset) added;
`recordClinicalEntities` additively creates a real ORPHA-coded
`FamilyHistory` per entry (familyCondition coded against ORPHA only --
no ICD-11/MONDO picker exists in this wizard). Merged at `fdfe6349`.

Both slices followed the identical shape: `clinicalDataSchema` gained
the new array field, `buildClinicalData`/`recordClinicalEntities`
wired it additively (best-effort, never fails the intake), 2 new
native-only unit cases each in `intakeWizard.clinicalEntities.test.js`,
and #696's real-backend Playwright spec
(`tests/e2e/intake-wizard.spec.ts`'s "Clinical-entity wiring" describe
block) extended once per slice to submit+assert the new entity
alongside the others from one live submission. Both merged, closed,
progress-commented on #707.

**Known gap, flagged not fixed (both slices):** neither
`allergy-intolerance.service.js` nor `family-history.service.js` gates
its coded field on `activeCodeValidator` (RF005 AC#4) -- pre-existing
since #692, not added here to keep both slices scoped to "UI + wiring."
Tracked as
[**#714**](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/714)
(now covers both entities via a follow-up comment, not duplicated).

## What landed this sitting

- 2 merge commits (`b4889219`, `fdfe6349`) on
  `feature/docker-e2e-backend-integration`.
- #708, #709 closed. #707 progress-commented twice (1/6, then 2/6).
- **#714** filed (AllergyIntolerance's missing RF005 AC#4 gate), later
  broadened via comment to cover FamilyHistory's identical gap too.
- **Friction found and filed (skills-pack, not this repo's tracker):**
  the real-backend Playwright spec failed twice in a row right after a
  fresh `--build` rebuild of `backend-app-test`/`frontend-app-test`
  (stuck on step 2, "Próximo" not advancing) -- looked exactly like a
  regression from this sitting's own code, but resolved cleanly on
  retry with zero code changes, and reproduced-clean twice more after.
  Root cause not confirmed (likely a post-rebuild Vite/container
  cold-start timing issue), but real enough to cost debugging time.
  Filed as
  [dyeallpies-skills-pack#377](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/377)
  so a future session facing the identical symptom right after a
  rebuild knows to retry once before chasing a phantom regression.
- The `resolve-issue` pre-close routing gate needed a fresh invocation
  immediately before each `gh issue close` call, both times -- an
  intervening `gh issue view <N> --json state` (itself required by
  `resolve-issue`'s own "check state before closing" instruction)
  un-satisfies the gate. Mechanical, cost two extra Skill calls this
  sitting, didn't block anything.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `fdfe6349`. Both per-issue branches (`test/708-...`,
  `test/709-...`) were merged `--no-ff` and deleted locally (neither
  was ever pushed remotely).
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- **Docker: UP.** `backend-app-test`/`frontend-app-test` rebuilt with
  `--build` twice this sitting (once per slice) to pick up source
  changes; `playwright-runner` stopped before each manual run, left
  stopped. Stack left running for the next #707 pickup.

## Recommended next steps

**#707's 4 remaining sub-slices (#710-713) are the live, unblocked
queue** -- same shape as #708/#709, each independent, each `build-loop`
shaped:
- #710 Procedure intake-wizard UI + wiring
- #711 ClinicalObservation intake-wizard UI + wiring (genuinely new UI,
  no existing field to repurpose -- likely larger)
- #712 ClinicalOutcome intake-wizard UI + wiring (genuinely new UI --
  likely larger)
- #713 real CCI algorithm + `DerivedScore` wiring (a different shape
  from the other 5 -- an actual scoring algorithm, not a data-mapping
  slice; expect this one to need more design thought)

No slice depends on another; pick any. #711/#712/#713 are the three
likely-larger/different-shaped ones (flagged since #707 was filed).

**New, separate from #707:** #714 (AllergyIntolerance + FamilyHistory's
missing RF005 AC#4 gate) -- ordinary backlog, not part of #707's queue.

#674 stays parked on RF027 (Wave 4, not started, out of scope) -- unless
Dennis pulls it forward, untouched.

Rabbit-hole budget: this sitting spent ~6pts (two full build-loop
slices, each new UI + backend wiring + schema + 2 unit tests + 1
extended e2e spec + 2 docs + issue filing/broadening, plus one skills-
pack friction report). Cumulative total was already well past the
~10pt advisory budget before this sitting started, and stays well past
it. 4 more slices (#710-713) remain queued -- worth another explicit
check-in with Dennis before continuing further this same sitting, same
as the last rotation.
