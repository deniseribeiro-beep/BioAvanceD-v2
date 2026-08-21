# HANDOFF

**Written:** 2026-08-21, later the same day as the #699 rotation, in the
same sitting under Dennis's "Continue. Check up to date docs to see if
answer can be found there or we can infer intention. Docker is on."
instruction.

## Rabbit-hole state: STILL INSIDE #646 -- #696 NOT closed, now blocked on #703 -- STOP HERE

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
This sitting picked up **#701** (the queue member #696 was blocked on)
and fixed it. #701 is **closed**. Verifying the fix against #696's own
real-backend Playwright proof surfaced a new, deeper blocker in the same
submission path, filed as **#703** and added to the tracker's live
queue. #696 itself remains **not closed** -- it is still a legitimate
red test, now blocked by #703 instead of #701.

## What landed this sitting

- **Docs-vs-precedent investigation for #701.** Docs
  (`dict-02_DICIONARIO.md`, `dict-07_ALINHAMENTO_CODIGO.md`,
  `dict-08_MAIN_GAPS.md`, `canonical-data-contract-v1.md`) suggested the
  MIABIS enum gate in `SampleModel.validate()` was legacy debt to relax.
  But tracing every real call site (`sample.service.js`,
  `import.service.js` CSV/JSON, `import-lgpd.service.js`) showed the
  opposite: all 3 already treat `sampleType`/`sampleOrigin`/
  `extractionProtocol` (MIABIS) as genuinely distinct from `sprec.*`
  (SPREC axis codes), populated from different source columns. Docs
  describe a not-yet-implemented target state; live precedent won.
  Confirmed via a further grep: `frontend/src/config/constants/
  specimen.constants.js` is an existing, already-used mirror of the
  backend's exact MIABIS id/label lists (`SampleWithdrawalReturnPage.tsx`
  already consumes it), and `ClinicalIntakeWizard.jsx` already had dead
  scaffolding (`sampleTypeOptions`/`sampleOriginOptions`/
  `extractionProtocolOptions`, computed but never rendered) built for
  exactly this. Filed the general lesson against the skills pack
  (`DyeAllPies/dyeallpies-skills-pack#374`): live call-site precedent can
  outweigh docs describing an unimplemented target architecture, and the
  correct fix is often already partially wired up in the codebase.

- **Branch `fix/701-intake-wizard-miabis-selectors`** (off
  `feature/docker-e2e-backend-integration`). Merged at **`f1583abe`**
  (fix commit `f1ccaa6d`); branch deleted both locally and remotely (no
  permission denial this time). Fixed `ClinicalIntakeWizard.jsx`:
  - Added real `sampleType`/`sampleOrigin`/`extractionProtocol`
    `<Select>` fields sourced from the frontend `specimen.constants.js`
    mirror, in a new "Classificação MIABIS" subsection of step 2.
  - Removed the sync effect that overwrote `formData.sampleType` with
    `formData.sprecSampleType`.
  - Made all three fields required in the step-2 Zod schema.
  - Stopped `buildSubmissionPayload` falling back to SPREC axis values
    for these three fields.
  - Added a `#701` regression test to `ClinicalIntakeWizard.test.jsx`.
  - Updated `tests/e2e/intake-wizard.spec.ts`'s clinical-entity-wiring
    spec to fill the 3 new required selects.
  - Verified against #696's own real-backend Playwright proof (docker
    compose test stack, brought up fresh this sitting, `--build`): the
    `sampleType/sampleOrigin/extractionProtocol inválido conforme
    MIABIS` 422 is **completely gone**.

- **#703 filed** (high severity, same blast radius as #699/#701): once
  the MIABIS gate passes, the same real submission now fails one layer
  deeper -- `POST /api/samples` 400s with "participantId inválido".
  Root cause traced and written up in the issue:
  `PatientIdentityService.js#matchOrUpsertParticipant` treats the
  wizard's `'placeholder'` participantId (sent for every new patient,
  #699's own established precedent) as a real, literal id instead of
  generating one (`matchedParticipantId = participantId || null` only
  regenerates when `participantId` is *falsy* -- `'placeholder'` is
  truthy) -- it even inserts a `patients` doc with
  `participantId: 'placeholder'`. Likely a consequence of #699's own
  fix, not chased further per this repo's one-bug-per-iteration rule.
  Suggested fix direction already in the issue (treat a
  non-`/^\d{8}$/`-matching participantId the same as empty, at both
  spots in `matchOrUpsertParticipant`). `#696`'s red assertion's inline
  comment now names #703, not #701.

- **#702 filed** (unrelated to #696, found during #701's investigation):
  `import-lgpd.service.js`'s post-validate DB-existence lookups
  (`sampleTypesCollection.findOne({ description: sampleData.sampleType
  })`) query by `description` using a value that's already validated as
  a MIABIS **id** (e.g. `"PLASMA"`), not the seeded doc's `description`
  field (e.g. `"Plasma"`) -- looks like an always-miss bug. Not
  reproduced/fixed this sitting, just traced and flagged.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to origin at
  `f1583abe`. Clean tree except the pre-existing untracked
  `.claude/skills/`/`api/backend/storage/assays/` (unrelated, not
  touched this sitting).
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- **Docker: DOWN** (torn down via `docker compose --env-file
  .env.test.example -f compose.test.yml down`, no `--volumes` -- named
  volumes persisted). This sitting's built images
  (`backend-app-test`/`frontend-app-test`/etc.) were removed
  (`docker rmi` + `docker builder prune -af`). Next session's first
  bring-up rebuilds from scratch. Re-run the same bring-up recipe next
  session (per `docker-workflow`'s bioavanced-v2 overlay) with
  `--build`.

## Recommended next steps

**None queued by Dennis explicitly.** Natural continuation: pick up
**#703** via `fix-bugs` -- root cause is already traced and a concrete
fix direction is written on the issue, so this should be a
faster-than-usual iteration. Once fixed, re-run
`tests/e2e/intake-wizard.spec.ts -g "Clinical-entity wiring"` against a
freshly-brought-up test stack to verify the rest of #696's own
assertions (Encounter/Condition/PhenotypeObservation/MedicationExposure
creation, including #698's still-separately-open OMIM-coding
assertion) actually pass, then close #696. #702 (LGPD lookup bug) is
available as a smaller, independent pick if preferred instead.
Alternative #646 queue pick if not continuing #703/#696 immediately:
**#674** (RF029 slice 6/6), still blocked on RF027/Wave 4 as of two
sittings ago -- re-check whether that's unblocked before picking. Same
discipline as every prior slice: branch first, re-invoke the routed
skill via the Skill tool per issue number before closing anything.
