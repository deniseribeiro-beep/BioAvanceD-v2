# HANDOFF

**Written:** 2026-08-21, continuing the same rabbit hole under Dennis's
"Continue rabbit hole" instruction this sitting. Docker is on.

## Rabbit-hole state: STILL INSIDE #646 -- #696 NOT closed, now blocked on #706 (needs Dennis's design call) -- STOP HERE

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
This sitting picked up **#705** (the queue member #696 was blocked on)
and fixed it. Verifying that fix against #696's own real-backend
Playwright proof surfaced yet another blocker one layer deeper, filed as
**#706** -- and unlike #701/#703/#704/#705, this one is a genuine design
fork, not a mechanical fix: it needs Dennis's read on what RF005 AC#4's
"somente" (only) wording means for a multi-coding entity. #696 itself
remains **not closed** -- it is still a legitimate red test, now blocked
by #706.

## What landed this sitting

- **#705 fixed and merged** (`fix/705-seed-active-terminology-concept-cleanup`
  -> `26b60679`, fix commit `b9905c67`): `seedParticipant.ts`'s
  `seedActiveTerminologyConcept` inserted a new `releaseStatus: 'active'`
  `referenceDatasetReleases` doc per call without ever deactivating the
  prior one, violating the same at-most-one-active-release-per-datasetCode
  invariant `activeCodeValidator.checkActiveCode` fails closed on
  (`ambiguous_active_release`) and the real importer's own `promote()`
  guarantees. Fixed in two parts: (1) `seedActiveTerminologyConcept` now
  supersedes any existing active release for the same `datasetCode`
  before inserting, mirroring `promote()`; (2) new
  `cleanupActiveTerminologyConcepts()`, wired into #696's `afterAll`,
  deletes the `e2e-696-*` fixtures the test itself inserts. Also ran a
  one-time cleanup directly against the live Docker Mongo volume (56
  stale docs removed across `referenceDatasetReleases`/
  `terminologyConcepts` -- more than the 42 estimated when #705 was
  filed, since #703/#704's own verification runs added a few more before
  this sitting started).

- **Verified #705's fix live** against the same Docker test stack
  (already up from before this sitting, not rebuilt): re-ran
  `tests/e2e/intake-wizard.spec.ts -g "Clinical-entity wiring"` (#696's
  own real-backend proof). Confirmed via `db.referenceDatasetReleases
  .aggregate` that exactly one active release now exists per
  `datasetCode` (was 15 each for ORPHA/ICD10/OMIM/HPO before), and the
  `ambiguous_active_release` failures are gone from the backend log.
  Ran an unrelated describe block in the same spec file
  ("Participant identity segregation") against the merged tree as a
  regression check -- both tests passed.

- **#706 filed** (design-fork bug, needs Dennis's call): the same live
  run that proved #705 then failed on `conditions` coming back empty --
  but for a different reason than #705's scope covered. Backend log
  shows `Falha ao registrar Condition ... conditionCoding[https://www
  .omim.org|OMIM:154700] ... status: unknown` (this part is #698's
  already-known OMIM-prefix-mismatch gap). What's new: confirmed via
  direct Mongo query (`db.conditions.find({}).toArray().length` was `0`
  for this run) that `condition.service.js#createCondition` does **not**
  silently drop the invalid OMIM coding and persist the rest, as #698's
  own "Impact" section claimed -- it rejects the **entire** Condition
  write when any single `conditionCoding` entry is invalid
  (`validateActiveCodes` fails the whole batch; `createCondition` never
  sets `allowControlledReview`, and its own code comment says "AC#4
  reads 'somente' (only) -- no controlled-review escape hatch here").
  Traced to `df03c2b4` (#690) -- the only commit touching this file, and
  its all-or-nothing shape reads as deliberate, not a regression. Posted
  a correction to #698's own impact section (comment on #698) since that
  issue's documented consequence no longer matches the code. #706 itself
  stays open, pending Dennis: is `createCondition`'s all-or-nothing gate
  the intended reading of AC#4 for multi-coding entities, or should each
  coding be individually gated (matching what #698 assumed)? Whichever
  direction, #696's own assertions (`conditions.toHaveLength(1)` +
  OMIM-absent) will need rewriting to match -- not attempted here, since
  it depends on the answer.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `26b60679`. Clean tree except the pre-existing untracked
  `.claude/skills/`/`api/backend/storage/assays/` (unrelated, not
  touched this sitting).
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- **Docker: UP.** Same stack, now with #705's fix's cleanup applied to
  the live volume (all accumulated `e2e-696-*` fixtures removed).
  Deliberately **not** torn down -- #696 is still open and the natural
  next step (once #706 is resolved) will want to re-run its Playwright
  proof against this same stack. If it does get torn down before that
  happens, re-run the bring-up recipe with `--build`.

## Recommended next steps

**None queued by Dennis explicitly, and the natural next step is
blocked on his input.** #706 needs a design-call answer (all-or-nothing
Condition write vs. per-coding gating) before any code or test-assertion
change can proceed -- this is not something to guess at. Once Dennis
answers on #706: fix `condition.service.js` (or confirm current
behavior is correct and just needs documenting), rewrite #696's
`conditions`/OMIM assertions to match, re-run the same Playwright proof,
and see how far the rest of #696's own assertions (`phenotypeObservations`,
`medicationExposures` -- these weren't reached this run since the test
throws on the `conditions` assertion first) actually get. Close #696
once all its own assertions pass; file whatever blocks next if not.

Rabbit-hole budget so far this hole: #701 (~3pts) + #703 (~3pts) + #704
(~1pt) + #705 (~5pts, multi-part: fixture fix + afterAll cleanup +
one-time volume cleanup) = ~12/10 -- already over the advisory budget,
which is the other reason this sitting stopped here even setting #706's
own blocked status aside.

Alternative #646 queue pick if not continuing #696/#706 (e.g. if Dennis
hasn't answered #706 yet): **#674** (RF029 slice 6/6), still blocked on
RF027/Wave 4 as of several sittings ago -- re-check whether that's
unblocked before picking. Same discipline as every prior slice: branch
first, re-invoke the routed skill via the Skill tool per issue number
before closing anything.
