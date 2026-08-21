# HANDOFF

**Written:** 2026-08-21, after fixing #699 and re-verifying #696's
real-backend Playwright proof, in a fresh sitting under Dennis's
"Continue. See if docs have a direction first. Docker is on." instruction.
This rotation supersedes the prior #696/#699 rotation (written on the
now-deleted `fix/696-...` branch, never separately merged into this
branch's own `HANDOFF.md` history -- everything relevant from it is
captured fresh below).

## Rabbit-hole state: STILL INSIDE #646 -- #696 NOT closed, now blocked on #701 (a real product-code decision only Dennis can make) -- STOP HERE

**Tracker: #646** (Wave 3 kickoff -- RF014/015/016/017/024/025/026/029).
This sitting picked up **#699** (the queue member #696 was blocked on)
and fixed it. #699 is **closed**. But fixing it surfaced a new, deeper
blocker in the same real submission path, filed as **#701** and added to
the tracker's live queue. #696 itself remains **not closed** -- it is
still a legitimate red test, now blocked by #701 instead of #699.
Continuing #696 further is blocked until Dennis decides #701's fix
direction -- not something a test-loop/fix-bugs iteration can guess at.

## What landed this sitting

- **Docs research first, per Dennis's instruction.** Checked
  `docs/architecture/canonical-data-contract-v1.md` (confirmed via git
  log to already be kept current through #575's `ParticipantIdentity`
  segregation -- not stale, despite an older flag in
  `E2E_TRACEABILITY_PLAN.md` suggesting otherwise) against the
  `canonical.v1.intake` AJV contract (`api/backend/src/contracts/canonical/v1/index.js`)
  -- they match exactly. Converted `docs/docs-7-31-2026/manuscript/
  2.2-Additional_file_2_Polyglot_Persistence_Data_Model.docx` to markdown
  via `pandoc` (available on this machine) per Dennis's "more up to date
  docs" nudge -- confirmed it's architecture-level (entity/persistence
  classification), doesn't add field-level detail beyond what
  `canonical-data-contract-v1.md` already has, and doesn't contradict it.
  Conclusion: **the contract was correct; the frontend payload had
  drifted from it** -- not a contract-relaxation call.

- **Branch `fix/699-canonical-intake-contract-payload`** (off
  `feature/docker-e2e-backend-integration`, cherry-picking #696's own
  test-only commit from its branch first so there was something to
  reproduce against -- see pack#373 for writing this pattern down
  properly). Merged into `feature/docker-e2e-backend-integration` at
  **`e1108a7a`**; branch deleted both locally and remotely. Fixed
  `ClinicalIntakeWizard.jsx`'s `buildSubmissionPayload` on all 5 axes
  #699 named:
  - `participant.prontuario` -> `recordNumber`.
  - Empty `participantId`/`specimenId` for a new patient/specimen -> a
    non-empty `'placeholder'` string (server always regenerates both
    server-side; mirrors the exact precedent
    `tests/e2e/helpers/seedParticipant.ts`'s `createRealParticipant`
    already documents for `POST /api/patients`).
  - `specimen.collectionInstitution`/`collectionInstitutionAcronym` --
    traced every backend call site (zero consumers, confirmed by grep)
    and dropped both from the payload rather than punting to Dennis; the
    contract's real field, `collectionSite`, is an Organization
    reference the wizard has no picker for -- building that is a
    separate, larger feature, not this bug fix.
  - `specimen.sprec` -- added a new `buildIntakeSprecPayload` (kept
    `buildCanonicalSprecPayload` itself unchanged, since the quality-
    preview and sample-integrity callers still need its `{code, label}`
    object shape) that flattens to the contract's plain-string axes plus
    a top-level `code`/`version` (`SPREC_VERSION = 'SPREC-2.0'`, mirroring
    the backend's own `rcs-reference-data.js` constant -- no shared
    constant exists across the frontend/backend split).
  - `birthDate` -- `normalizeBirthDateForPayload` now emits bare
    `YYYY-MM-DD`, not a full ISO datetime (contract is `format: 'date'`).
  - Added a `#699` regression test to `ClinicalIntakeWizard.test.jsx`
    covering all of the above at the unit level (fast, no Docker needed).
  - Verified against #696's own real-backend Playwright proof (docker
    compose test stack, brought up fresh this sitting): the
    `NON_CANONICAL_FIELD` 422 is **completely gone**.

- **#701 filed** (high severity, same blast radius as #699): once the
  AJV gate passes, the same real submission now 422s one layer deeper --
  `sampleType`/`sampleOrigin`/`extractionProtocol` send real SPREC-standard
  axis codes (e.g. `BLD`, `PL1`, `SAL`), not the app's own closed
  11/4/4-value MIABIS enum `SampleModel.validate()`
  (`api/backend/src/models/Sample.js:154-160`) requires. No mapping table
  exists anywhere in the codebase, and the wizard has no separate UI
  selector for the MIABIS fields at all. **Genuine design decision, left
  for Dennis** (posed as 3 options on the issue): build a real
  SPREC-code -> MIABIS-id mapping table, add separate MIABIS UI
  selectors, or drop the MIABIS gate for this intake path. `#696`'s red
  assertion's inline comment now names #701, not #699, per this repo's
  "RED tests are legitimate deliverables" convention.

- **Two pack-repo issues filed** (`DyeAllPies/dyeallpies-skills-pack`),
  both process/tooling findings, not product bugs:
  - **#372** -- `branch-guard.cjs` misparses a bare `git branch | grep
    <pattern>` (read-only listing) as `git branch <name>` (create mode),
    capturing `"|"` itself as a candidate branch name and blocking the
    whole command. Confirmed while checking whether `fix/696-...` still
    existed locally after a `-d` delete.
  - **#373** -- documents the cherry-pick-the-test-from-another-branch
    pattern used this sitting (fix-bugs' own overlay names the "test
    lives elsewhere" exception but not the mechanic).

## Repo state

- On `feature/docker-e2e-backend-integration`, up to date with origin at
  `e1108a7a` (the #699 merge commit). Clean tree except this file's
  rotation and the pre-existing untracked `.claude/skills/`/
  `api/backend/storage/assays/` (unrelated, not touched this sitting).
- No PR to `main` exists. `main` stays frozen per this repo's convention.
- `origin/fix/696-intake-wizard-clinical-entities-real-backend-e2e` is
  now **fully superseded** (confirmed via diff against the integration
  branch -- only this sitting's #699/#701 comment update differs) but
  **still exists on the remote** -- local copy deleted, but `git push
  origin --delete` for it was denied by the auto-mode permission
  classifier (known repo gotcha, documented in fix-bugs' own "Ending an
  iteration" section). Harmless; Dennis can delete it manually or grant
  the permission if he wants this automated.
- **Docker: DOWN** (torn down at session end via `docker compose
  --env-file .env.test.example -f compose.test.yml down`, no
  `--volumes` -- named volumes, including `admin-bootstrap-test`'s
  completed bootstrap, persisted). This sitting's built images
  (`backend-app-test`/`frontend-app-test`/etc.) were **removed** by the
  end-of-session `clean-up` pass (`docker rmi` + `docker builder prune
  -af`, per `docker-workflow`'s hygiene rule) -- next session's first
  bring-up will rebuild from scratch (no build cache left either), not
  reuse an already-fresh image. Re-run the same bring-up recipe next
  session (per `docker-workflow`'s bioavanced-v2 overlay) with
  `--build`; confirm the admin bootstrap/seed data in the preserved
  volumes before assuming it's still there, per the volume-accumulation
  gotcha the overlay already documents.

## Recommended next steps

**None queued by Dennis explicitly.** Natural continuation: Dennis
decides #701's fix direction (SPREC->MIABIS mapping table vs. separate
UI selectors vs. dropping the gate) -- once decided and built, re-run
`tests/e2e/intake-wizard.spec.ts -g "Clinical-entity wiring"` against the
still-up (or freshly-brought-up) test stack to verify the rest of #696's
own assertions (Encounter/Condition/PhenotypeObservation/
MedicationExposure creation, including #698's still-separately-open
OMIM-coding-silently-dropped assertion) actually pass, then close #696.
Alternative #646 queue pick if not continuing #701/#696 immediately:
**#674** (RF029 slice 6/6), still blocked on RF027/Wave 4 as of the prior
sitting's check -- re-check whether that's unblocked before picking.
Same discipline as every prior slice: branch first, re-invoke the routed
skill via the Skill tool per issue number before closing anything.
