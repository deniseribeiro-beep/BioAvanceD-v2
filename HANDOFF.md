# HANDOFF

**Written:** 2026-08-21, continuing the same rabbit hole under Dennis's
repeated "Keep descending" / "Next slice" instructions this sitting.
Docker is on.

## Rabbit-hole state: STILL INSIDE #646 -> #707 -- 4/6 sub-slices landed (#708-711), 2 remain (#712, #713)

**Tracker: #646** (Wave 3 kickoff) -> **#707** (RF005: wire remaining 6
clinical-data entities into real intake-wizard UI + a real CCI
algorithm).

This sitting picked up and landed four sub-slices via `build-loop`, back
to back:

- **#708 (AllergyIntolerance):** manual-entry allergen field (name + DCB
  code + reaction). Merged `b4889219`.
- **#709 (FamilyHistory):** manual-entry family-history field
  (relationship select + condition name + ORPHA code + onset). Merged
  `fdfe6349`.
- **#710 (Procedure):** manual-entry procedure field (name + code +
  required performed date + optional body-site text), coded against a
  newly-invented local system URI. Merged `d61993e2`.
- **#711 (ClinicalObservation):** manual-entry lab-result field (test
  name + LOINC code + value + unit + required effective date), coded
  against the real `http://loinc.org` systemUri (a genuine RF028
  importer exists). Merged `9a7efb2b`.

All four followed the identical shape: `clinicalDataSchema` gained the
new array field, `buildClinicalData`/`recordClinicalEntities` wired it
additively (best-effort, never fails the intake), 2 new native-only
unit cases each in `intakeWizard.clinicalEntities.test.js`, and #696's
real-backend Playwright spec
(`tests/e2e/intake-wizard.spec.ts`'s "Clinical-entity wiring" describe
block) extended once per slice to submit+assert the new entity
alongside the others from one live submission. All four merged, closed,
progress-commented on #707 (1/6 -> 2/6 -> 3/6 -> 4/6).

**Known gaps, flagged not fixed, filed as issues rather than silently
left undocumented:**
- [**#714**](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/714):
  none of the three manually-coded entities' services
  (`allergy-intolerance`/`family-history`/`procedure.service.js`) gate
  their coded field on `activeCodeValidator` (RF005 AC#4) --
  pre-existing since #692. One issue, three follow-up comments (not
  three duplicates); Procedure's comment flags a real nuance (its code
  has no real `ReferenceDatasetRelease` to gate against at all).
- [**dyeallpies-skills-pack#377**](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/377):
  a transient post-Docker-rebuild Playwright flakiness hit once (during
  #709's verification) -- resolved on retry, didn't recur in #710/#711's
  verification.
- [**dyeallpies-skills-pack#378**](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/378):
  #711's natural field name (`clinicalObservations`) turned out to
  already exist as an unrelated free-text notes field in the same
  schema/formData -- caught before it caused a real bug, but a genuine
  recurring risk for #712/#713's still-open slices, which wire into the
  identical growing payload.

## What landed this sitting

- 4 merge commits (`b4889219`, `fdfe6349`, `d61993e2`, `9a7efb2b`) on
  `feature/docker-e2e-backend-integration`.
- #708, #709, #710, #711 closed. #707 progress-commented four times
  (1/6, 2/6, 3/6, 4/6).
- **#714** filed and broadened via two follow-up comments (now covers
  all 3 manually-coded entities' gap).
- Two skills-pack friction reports filed:
  [#377](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/377)
  (post-rebuild e2e flakiness) and
  [#378](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/378)
  (schema-key naming-collision risk, directly relevant to #712/#713).
- The `resolve-issue` pre-close routing gate needed a fresh invocation
  immediately before each `gh issue close` call, all four times --
  mechanical, cost extra Skill calls, didn't block anything. Not
  re-reported (already noted after #709, same shape, no new
  information).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `9a7efb2b`. All four per-issue branches (`test/708-...` through
  `test/711-...`) were merged `--no-ff` and deleted locally (none was
  ever pushed remotely).
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- **Docker: DOWN.** `backend-app-test`/`frontend-app-test` were rebuilt
  with `--build` four times this sitting (once per slice) to pick up
  source changes, and every e2e run happened against that stack. It was
  inherited (already up ~2h before this session started, not spun up by
  this session) -- at session end, with the rabbit hole paused and
  #712/#713 not being picked up immediately, `clean-up`'s "inherited
  stack" check asked Dennis whether to tear it down rather than leave it
  running unattended; he chose teardown (`docker compose ... down`,
  named volumes untouched). The next #707 pickup needs a fresh
  `docker compose up` per `docker-workflow`'s recipe, not an assumoption
  the stack is still up.

## Recommended next steps

**#707's 2 remaining sub-slices (#712, #713) are the live queue** --
both confirmed genuinely different-shaped from #708-711 (read each
issue's own body fresh, not just #707's tracking summary, before
starting either):

- **#712 (ClinicalOutcome):** "No longitudinal-outcome UI exists in the
  intake wizard today (progression/remission/relapse/etc.) -- unlike the
  other 5 slices, this one needs genuinely new frontend fields, not just
  a backend mapping." Model/service already exist (#691) -- read
  `docs/architecture/canonical-data-contract-v1.md`'s ClinicalOutcome
  section for the field list before designing the UI. **Before naming
  any new formData/schema field for this slice, grep for the exact name
  first** -- see dyeallpies-skills-pack#378 above; this payload has 40+
  existing keys and at least one (`clinicalObservations`) doesn't
  obviously map to any dict-02 entity.
- **#713 (DerivedScore/CCI):** explicitly NOT a UI-wiring slice like the
  other 5 -- "the wizard already collects `charlsonConditions` ... but
  nothing computes the actual Charlson Comorbidity Index numeric score
  -- that needs a real weighted-scoring algorithm (each condition has a
  defined CCI weight), not just a data mapping." Dennis already
  confirmed (2026-08-21, per the issue body) to implement the real
  algorithm rather than leave `charlsonComorbidities` as the informal
  array it is today. Needs a documented CCI weight table + standard
  summation, wired to create a `DerivedScore` with `scoreComponents`
  populated per component condition (dict-02 ELM-0259 requires this
  non-empty -- "nunca armazenar somente o escore final"). Definition of
  done explicitly calls for a real-backend Playwright proof that a
  submission with known comorbidities produces the *correct numeric
  score* -- this is a correctness-of-computation proof, not just a
  wiring-exists proof like #708-712's specs.

No dependency between #712/#713; pick either. Both are expected to take
meaningfully longer than #708-711 did.

**New, separate from #707:** #714 (three entities' missing RF005 AC#4
gate) -- ordinary backlog, not part of #707's queue.

#674 stays parked on RF027 (Wave 4, not started, out of scope) -- unless
Dennis pulls it forward, untouched.

Rabbit-hole budget: this sitting spent ~12pts (four full build-loop
slices, each new UI + backend wiring + schema + 2 unit tests + 1
extended e2e spec + 2 docs + issue filing/broadening, plus two
skills-pack friction reports). Cumulative total was already well past
the ~10pt advisory budget before this sitting started, and this
sitting alone now exceeds the full advisory budget on its own. 2 slices
remain (#712, #713), both explicitly larger/differently-shaped than the
four just landed -- strongly worth an explicit check-in with Dennis
before continuing, more so than the last three rotations.
