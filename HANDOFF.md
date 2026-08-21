# HANDOFF

**Written:** 2026-08-21, continuing the same rabbit hole under Dennis's
"Keep descending" instruction this sitting. Docker is on.

## Rabbit-hole state: STILL INSIDE #646 -> #707 -- 1/6 sub-slices landed (#708), 5 remain (#709-713)

**Tracker: #646** (Wave 3 kickoff) -> **#707** (RF005: wire remaining 6
clinical-data entities into real intake-wizard UI + a real CCI
algorithm).

This sitting picked up **#708** (AllergyIntolerance intake-wizard UI +
wiring) via `build-loop` and landed it in full:

1. Added a manual-entry allergen field (name + DCB code + reaction) to
   `ClinicalIntakeWizard.jsx`'s clinical step -- no dictionary picker
   exists for DCB in this repo, same "accept manual entry" precedent the
   wizard's diagnosis codes already use.
2. `recordClinicalEntities` (`intakeWizard.js`) additively creates a
   real, DCB-coded `AllergyIntolerance` document per wizard-collected
   entry -- same additive best-effort pattern #693 used for
   Encounter/Condition/PhenotypeObservation/MedicationExposure.
   `clinicalDataSchema` (`contracts/canonical/v1/index.js`) gained the
   `allergies` array.
3. Proof: 2 new native-only cases in
   `tests/unit/intakeWizard.clinicalEntities.test.js`, plus #696's
   real-backend Playwright spec (`tests/e2e/intake-wizard.spec.ts`'s
   "Clinical-entity wiring" describe block) extended to submit and
   assert a real `AllergyIntolerance` alongside the other 4 entities
   from one live submission -- ran against the real docker-compose test
   stack, passing (6/6 in that file).
4. Docs updated: `docs/architecture/canonical-data-contract-v1.md`'s
   AllergyIntolerance section, `E2E_TRACEABILITY_PLAN.md`'s RF005 row.
5. **Scope call, flagged not fixed:** `allergy-intolerance.service.js`
   does not gate `allergenCoding` on `activeCodeValidator` (RF005 AC#4)
   -- a pre-existing gap since #692, not added here to keep #708 scoped
   to "UI + wiring." Filed separately as
   [**#714**](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/714)
   rather than expanding this slice or silently leaving it undocumented.
6. Merged to `feature/docker-e2e-backend-integration` at `b4889219`,
   pushed. Closed #708 with the landing summary. Progress-commented on
   #707 (1/6 done).

## What landed this sitting

- 1 merge commit (`b4889219`) on `feature/docker-e2e-backend-integration`
  carrying #708's full slice (backend + frontend + tests + docs, 7
  files, +241/-8).
- #708 closed. #707 progress-commented. **#714** filed (new gap:
  AllergyIntolerance's missing RF005 AC#4 gate).
- No friction this sitting -- `docker-workflow`'s rebuild-before-verify
  recipe worked exactly as documented; the `resolve-issue` pre-close
  routing gate needed a second fresh invocation right before the close
  call (a `gh issue view` in between the first invocation and the close
  attempt didn't count as still-routed) -- mechanical, not a real
  ambiguity, didn't slow things down materially.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `b4889219`. The per-issue branch (`test/708-allergy-intolerance-
  intake-ui`) was merged `--no-ff` and deleted locally (never pushed
  remotely, so nothing to delete there).
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- **Docker: UP.** `backend-app-test`/`frontend-app-test` were rebuilt
  with `--build` this sitting (both are build-not-mount services) to
  pick up #708's source changes, then verified via the real e2e spec.
  `playwright-runner` was stopped before the manual run (per its
  auto-run-on-`up`gotcha) and left stopped. Left running for the next
  #707 pickup -- not torn down.

## Recommended next steps

**#707's 5 remaining sub-slices (#709-713) are the live, unblocked
queue** -- same shape as #708, each independent, each `build-loop`
shaped (real intake-wizard UI + backend wiring + real-backend Playwright
proof):
- #709 FamilyHistory intake-wizard UI + wiring
- #710 Procedure intake-wizard UI + wiring
- #711 ClinicalObservation intake-wizard UI + wiring (genuinely new UI,
  no existing field to repurpose -- likely larger)
- #712 ClinicalOutcome intake-wizard UI + wiring (genuinely new UI --
  likely larger)
- #713 real CCI algorithm + `DerivedScore` wiring

No slice depends on another; pick any. #711/#712 are still the two
likely-larger ones (flagged since #707 was filed, unchanged by this
sitting).

**New, separate from #707:** #714 (AllergyIntolerance's missing RF005
AC#4 gate) -- ordinary backlog, not part of #707's queue, no urgency
stated.

#674 stays parked on RF027 (Wave 4, not started, out of scope) -- unless
Dennis pulls it forward, this stays untouched.

Rabbit-hole budget: this sitting spent ~3pts (one full build-loop slice:
new UI + backend wiring + schema + 2 unit tests + 1 extended e2e spec +
2 docs + 1 new filed issue). Cumulative total was already well past the
~10pt advisory budget before this sitting started, and stays there. 5
more slices (#709-713) remain queued on top of that -- worth another
explicit check-in with Dennis before continuing further this same
sitting, per the rabbit-hole skill's own pacing guidance, even though
"keep descending" was the standing instruction coming in.
