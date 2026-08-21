# HANDOFF

**Written:** 2026-08-21, same day as the #701/#703 rotations, same sitting,
under Dennis's continuation of the standing "Continue" instruction. Docker
is on.

## Rabbit-hole state: STILL INSIDE #646 -- #696 NOT closed, now blocked on #704 -- STOP HERE

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
This sitting picked up **#703** (the queue member #696 was blocked on)
and fixed it. #703 is **closed**. Verifying the fix against #696's own
real-backend Playwright proof surfaced a new blocker one layer deeper in
the same test -- but this time a test-only bug, not a product bug --
filed as **#704** and added to the tracker's live queue. #696 itself
remains **not closed** -- it is still a legitimate red test, now blocked
by #704 instead of #703.

## What landed this sitting

- **Branch `fix/703-placeholder-participant-id`** (off
  `feature/docker-e2e-backend-integration`). Merged at **`a121cff7`**
  (fix commit `c8845743`); branch deleted both locally and remotely (no
  permission denial this time -- the remote delete succeeded).
  `PatientIdentityService.js#matchOrUpsertParticipant`'s
  `matchedParticipantId = participantId || null` accepted any truthy
  string -- including the intake wizard's `'placeholder'` sentinel (sent
  for every new patient per #699's own precedent) -- as a real, literal
  id instead of validating its format. Fixed by replacing the truthy
  check with `/^\d{8}$/.test(participantId)`, applied at three spots:
  - The `matchedParticipantId` assignment (so an invalid id now falls
    through to the existing name+birthDate matching, same as no id
    supplied).
  - The `generatedParticipantId` fallback on the new-patient insert path
    (so an invalid id no longer gets inserted into `patients` verbatim).
  - The insufficient-identification guard (`if (!participantId &&
    ...)`) -- **defensive addition beyond the issue's literal two spots**:
    narrowing the gate above means a caller with an invalid-but-truthy
    participantId and no name/birthDate would now reach the
    name+birthDate-matching branch and crash on `null.getFullYear()`.
    Traced both real call sites (`intakeWizard.js`,
    `import-lgpd.service.js`) -- neither sends this combination today, so
    it was a latent (not live) crash, but a direct one-line consequence
    of the same edit, not scope creep. Filed the general lesson against
    the skills pack (`DyeAllPies/dyeallpies-skills-pack#375`): narrowing
    a truthy/type gate to a stricter validity check can newly expose a
    branch to inputs its own logic implicitly assumed were already
    screened out; trace what else in the function relied on the old
    gate, not just whether the branch itself is reachable.
  - Two new unit tests in `patient-identity.service.test.js` (#703):
    reproduce the placeholder-as-literal-id insert bug, and confirm the
    name+birthDate fallback still matches an existing patient despite a
    placeholder id. Both written and confirmed **failing against pre-fix
    code** before the fix landed.
  - Updated `tests/e2e/intake-wizard.spec.ts`'s #696 pinned-bug comment
    (un-weakened -- #703 is fixed, no longer describes a live blocker).

- **Verified two ways:**
  - Unit: `patient-identity.service.test.js` (12/12) plus a wider net
    (`PatientIdentityService.identityMigration.unit.test.js`,
    `intakeWizard.clinicalEntities.test.js`, `intakeWizard.routes.test.js`,
    `intakeWizard.governance-integration.test.js`,
    `import-lgpd.service.importSamples.unit.test.js`,
    `smart-import.api.test.js`) -- 92/92 green, both pre-merge and
    re-confirmed on the merged integration-branch tree.
  - Live: brought the Docker test stack up fresh with `--build` (prior
    session's images had been pruned) via `docker compose --env-file
    .env.test.example -f compose.test.yml up -d --build`. Ran
    `tests/e2e/intake-wizard.spec.ts -g "Clinical-entity wiring"` (#696's
    own real-backend proof) against it: the `POST /api/samples` 400
    "participantId inválido" is **completely gone** --
    `response.ok()`/`body.success` both now pass.

- **#704 filed** (test-only, no product bug): that same live run's very
  next assertion, `body?.data?.patientMatch?.patientID`, comes back
  `undefined`. Traced to `intakeWizard.js`'s actual success response
  (`~line 724`): `patientMatch` is a **top-level** key on the response
  object -- there is no `data` wrapper. The e2e spec's assertion was
  written speculatively (against a payload shape it never actually
  reached before, since #699/#701/#703 blocked it earlier every time)
  and has always read the wrong path. Correct path: `body?.patientMatch
  ?.patientID`. Not fixed this sitting -- staying on the picked #703
  issue per this repo's one-bug-per-iteration rule -- but it's a trivial,
  unambiguous one-line correction, no design call needed.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `a121cff7`. Clean tree except the pre-existing untracked
  `.claude/skills/`/`api/backend/storage/assays/` (unrelated, not
  touched this sitting).
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- **Docker: UP.** Fresh images built this sitting (`backend-app-test`/
  `frontend-app-test`/etc, all healthy) -- deliberately **not** torn down,
  since the natural next step (#704) gets re-verified against this same
  live stack. If it does get torn down before that happens, re-run the
  same bring-up recipe with `--build` (images are not expected to
  persist between sessions per this repo's established convention).

## Recommended next steps

**None queued by Dennis explicitly.** Natural continuation: pick up
**#704** next -- small, unambiguous, test-only (correct
`tests/e2e/intake-wizard.spec.ts`'s `body?.data?.patientMatch
?.patientID` to `body?.patientMatch?.patientID`), no product code
expected. Re-run `tests/e2e/intake-wizard.spec.ts -g "Clinical-entity
wiring"` against the still-up Docker stack afterward to see how far the
rest of #696's own assertions (Encounter/Condition/PhenotypeObservation/
MedicationExposure creation, including #698's still-separately-open
OMIM-coding assertion) actually get -- close #696 if they all pass, file
whatever blocks next if not. Rabbit-hole budget so far this hole:
#701 (~3pts) + #703 (~3pts) = ~6/10; #704 is small (~1pt), comfortably
within budget to pick up in the same sitting.
Alternative #646 queue pick if not continuing #704/#696 immediately:
**#674** (RF029 slice 6/6), still blocked on RF027/Wave 4 as of several
sittings ago -- re-check whether that's unblocked before picking. Same
discipline as every prior slice: branch first, re-invoke the routed
skill via the Skill tool per issue number before closing anything.
