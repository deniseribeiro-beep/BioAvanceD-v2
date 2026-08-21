# HANDOFF

**Written:** 2026-08-21, same sitting as the #703 rotation, continuing
under Dennis's standing "Continue" instruction. Docker is on.

## Rabbit-hole state: STILL INSIDE #646 -- #696 NOT closed, now blocked on #705 -- STOP HERE

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
This sitting picked up **#703** and **#704** (successive queue members
#696 was blocked on) and fixed both. Verifying #704's fix against #696's
own real-backend Playwright proof surfaced a new blocker one layer
deeper, filed as **#705** and added to the tracker's live queue. #696
itself remains **not closed** -- it is still a legitimate red test, now
blocked by #705.

## What landed this sitting

- **#703 fixed and merged** (`fix/703-placeholder-participant-id` ->
  `a121cff7`, fix commit `c8845743`): `PatientIdentityService.js
  #matchOrUpsertParticipant`'s `matchedParticipantId = participantId ||
  null` accepted any truthy string -- including the intake wizard's
  `'placeholder'` sentinel -- as a real, literal id. Fixed via
  `/^\d{8}$/.test(participantId)` at three spots (the
  `matchedParticipantId` assignment, the `generatedParticipantId`
  fallback, and the insufficient-identification guard -- the third spot
  is a defensive addition beyond the issue's literal two: narrowing the
  gate above newly exposes a null-`birthDate` crash to any caller
  supplying an invalid-but-truthy id with no name/birthDate; traced both
  real call sites and found this combination unreachable today, but it's
  a direct one-line consequence of the same edit). Two new unit tests in
  `patient-identity.service.test.js`, confirmed failing pre-fix, passing
  post-fix; wider net of 92 tests green. Filed the general lesson against
  the skills pack (`DyeAllPies/dyeallpies-skills-pack#375`): narrowing a
  truthy/type gate to a stricter validity check can newly expose a branch
  to inputs its own logic implicitly assumed were already screened out.

- **#704 fixed and merged** (`fix/704-intake-wizard-response-shape` ->
  `e1e07178`, fix commit `4b2ac8bc`): `tests/e2e/intake-wizard.spec.ts`'s
  #696 test read `body?.data?.patientMatch?.patientID`, but
  `intakeWizard.js`'s actual success response (`~line 724`) has no `data`
  wrapper -- `patientMatch` is a top-level key. Test-only, one-line fix;
  the wrong path was never exercised before since #699/#701/#703 each
  blocked execution earlier in the same test.

- **Verified both fixes live**, in sequence, against one Docker test
  stack brought up fresh with `--build` this sitting (prior session's
  images had been pruned): `docker compose --env-file .env.test.example
  -f compose.test.yml up -d --build`, then repeated runs of
  `tests/e2e/intake-wizard.spec.ts -g "Clinical-entity wiring"` (#696's
  own real-backend proof) as each fix landed. Confirmed genuine forward
  progress each time: #703's fix made the 400 "participantId inválido"
  disappear; #704's fix made `participantId` resolve and the test
  progress past the `encounters` assertion for the first time ever.

- **#705 filed** (test-fixture bug, not product code): the same live run
  that proved #704 then failed on `conditions` coming back empty.
  Backend logs show `activeCodeValidator` returning
  `ambiguous_active_release` for ORPHA/ICD-10/HPO `conditionCoding`/
  `hpoCoding` (separate from #698's already-known OMIM `unknown`-status
  gap). Traced via a direct `mongosh` query against the live test Mongo
  volume: **15 `releaseStatus: 'active'` `referenceDatasetReleases` docs
  each for ORPHA/ICD10/OMIM/HPO** -- one real bootstrap-seeded release
  (from `reference-data-bootstrap-orpha-test`/`-icd10-test`/`-omim-test`;
  no `-hpo-test` bootstrap exists, confirmed via `compose.test.yml`) plus
  **14 accumulated `e2e-696-*` fixtures from many past sessions' runs**
  of this same test's `seedActiveTerminologyConcept` helper
  (`tests/e2e/helpers/seedParticipant.ts`), which inserts a new active
  release every `beforeAll` without ever deactivating the prior one, and
  whose `afterAll` never cleans up the Mongo fixtures it inserted (only
  Neo4j/mongoClient/seedDb connection teardown). This has likely made the
  ORPHA/ICD10/HPO assertions structurally unpassable on this Docker
  volume for a long time -- just never previously reached, since
  #699/#701/#703/#704 each blocked execution earlier in the same test
  until now. Suggested fix (on the issue): (1) `seedActiveTerminologyConcept`
  should deactivate/delete any existing active release for the same
  `datasetCode` before inserting a new one, mirroring the real importer's
  own `pipeline.js#promote()` invariant; (2) the test's `afterAll` should
  clean up the `e2e-696-*`-prefixed docs it inserted. A one-time cleanup
  of the 42 already-accumulated fixture docs on the current shared volume
  will also be needed independent of the code fix.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `e1e07178`. Clean tree except the pre-existing untracked
  `.claude/skills/`/`api/backend/storage/assays/` (unrelated, not
  touched this sitting).
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- **Docker: UP.** Same fresh images from earlier this sitting (all
  healthy) -- deliberately **not** torn down, since the accumulated-
  fixture evidence for #705 lives in this volume's Mongo data and the
  natural next step (#705) will want it available to inspect/clean
  before or during the fix. If it does get torn down before that
  happens, re-run the same bring-up recipe with `--build`.

## Recommended next steps

**None queued by Dennis explicitly.** Natural continuation: pick up
**#705** next via `fix-bugs` -- root cause and a concrete two-part fix
direction are already traced and written on the issue, so this should be
a well-scoped iteration despite touching shared persistent state (the
Mongo fixture cleanup deserves care, not a rush). After fixing, re-run
`tests/e2e/intake-wizard.spec.ts -g "Clinical-entity wiring"` against the
still-up (or freshly rebuilt, if torn down meanwhile) Docker stack to see
how far the rest of #696's own assertions (`conditionCodings` containing
ORPHA/ICD10 -- OMIM absent per #698 is the expected, already-asserted
behavior, not a new gap --, `phenotypeObservations`, `medicationExposures`)
actually get once ORPHA/ICD10/HPO resolve as active. Close #696 once all
its own assertions pass; file whatever blocks next if not.
Rabbit-hole budget so far this hole: #701 (~3pts) + #703 (~3pts) + #704
(~1pt) = ~7/10 -- #705 looks medium-to-large, which is why this sitting
stopped here rather than picking it up immediately.
Alternative #646 queue pick if not continuing #705/#696 immediately:
**#674** (RF029 slice 6/6), still blocked on RF027/Wave 4 as of several
sittings ago -- re-check whether that's unblocked before picking. Same
discipline as every prior slice: branch first, re-invoke the routed
skill via the Skill tool per issue number before closing anything.
