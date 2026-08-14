# HANDOFF

**Written:** 2026-08-14, end of session on `fix/575-remove-patient-legacy-fields`.

## What happened this session

Opened by reading the prior handoff, then asked Dennis where to focus.
He picked `#575` (the atomic Patient civil-identity field removal, the
queue's other big remaining item per last session's handoff).

### `#575` — implemented and pushed, not yet merged or closed

Full plan-mode research pass first: 3 parallel `Explore` agents verified
every write path `#575` named still existed at (roughly) the cited
lines, then a targeted repo-wide grep swept for any remaining
`.patientName`/`.birthDate` reads to confirm the read side was already
fully migrated by `#561`-`#564` — it was, so this really was a pure
write-side + schema change, not a rediscovery of missed consumers.

Implemented on `fix/575-remove-patient-legacy-fields` (based on
`feature/docker-e2e-backend-integration`), commit `e9d010eb`, pushed:

- `Patient.js`: `patientName`/`birthDate`/`identityDocument` dropped
  from the required-fields list and allowlist — now rejected as
  non-canonical.
- `patient.service.js`: `createPatient`/`updatePatient` stop writing
  the three fields to `patients`; `ensurePatientIndexes` drops the two
  now-dead indexes from already-deployed collections.
- `PatientIdentityService.js#matchOrUpsertParticipant`: restructured so
  only non-identity fields hit `patients` (matching already resolved via
  `ParticipantIdentity`, so this was a pure cleanup, not a behavior
  change).
- `import.service.js` / `import-lgpd.service.js`: same pattern across
  all their patient/sample write paths.
- New shared helper `api/backend/src/utils/legacyPatientIdentityFields.js`
  used at all 8 write-path call sites.
- Caught and fixed two real regressions the removal would have silently
  introduced: `PatientModel.validate()` no longer enforced
  patientName/birthDate presence, so explicit checks were added in
  `createPatient` and `import.service.js`'s JSON/CSV loops (mirroring
  what `import-lgpd.service.js` already had independently). Per
  `resolve-issue`'s "bugs that block the issue's own acceptance
  criteria get fixed inline" — these were caused by this session's own
  change, not pre-existing.
- Frontend `Patient` TS type: `patientName`/`birthDate` now optional.
- `docs/architecture/canonical-data-contract-v1.md` updated to reflect
  the removal as landed.
- 12 test files reworked to match. Targeted run: 398 passing / 5
  failing — all 5 confirmed via `git stash` to be pre-existing bugs on
  the base branch, unrelated to `#575` (stale mocks predating `#561`'s
  move to `ParticipantIdentity`-based lookups). Filed as `#580` and
  `#581`. Frontend `typecheck:full` is clean.

**Not run this session:** the full native suite and the Docker/real-backend
e2e gate — per `resolve-issue`'s default execution contract those are
opt-in per session or saved for the ship gate, not run per-iteration.
Left this as an open question for Dennis at session end (run now before
review, or hold for the ship gate) — no answer received before the
session closed out.

### Issues filed this session

All in `deniseribeiro-beep/BioAvanceD-v2`:

- **`#580`**: `patients.api.test.js`'s duplicate-conflict test mocks a
  stale `$or` query shape `checkIdentifierConflict`/`checkDuplicatePatient`
  stopped using after `#561`. Pre-existing, found while verifying `#575`.
- **`#581`**: same root-cause family as `#580`, in
  `patient.service.createUpdate.gaps.unit.test.js` and
  `patient.service.query-update.gaps.unit.test.js` (4 tests total).
  Pre-existing.
- **`#582`**: `fhir.service.js#toFhirPatient` is dead code reading
  `patientName`/`birthDate` — fields `#575` just removed from `Patient`.
  Confirmed no callers anywhere in `src/`. Left for its owner to decide
  delete-vs-repoint, per `#575`'s own scope note not to silently touch
  it.
- **`#583`** (minor): several `patient.service`-family test mocks lack
  a `dropIndex` stub, so `#575`'s new drop-index call logs harmless but
  noisy `WARN`s in those files' test output.

## Repo state

- **`fix/575-remove-patient-legacy-fields`**: pushed at `e9d010eb`,
  based on `feature/docker-e2e-backend-integration`. Working tree clean.
  **Not merged, not closed** — `#575` is implemented and its own targeted
  tests are green, but Dennis hasn't yet reviewed the diff or said
  whether to run the full suite/Docker gate before merging. Read the
  diff and decide next: either ask for the full/Docker gate to run first,
  or say go-ahead to fold it into `feature/docker-e2e-backend-integration`
  per `resolve-issue`'s normal close/merge flow.
- **`feature/docker-e2e-backend-integration`**: unchanged this session,
  still at `7b2341d3` per the prior handoff (this session branched off
  it but never merged back).

## Next steps

**None queued** — Dennis didn't name a next issue for after `#575`.

Immediate unfinished thread: **`#575` itself** needs Dennis's review of
the pushed diff, a decision on the full-suite/Docker gate timing, and
then (if green) the normal merge-into-integration-branch +
close-the-issue step per `resolve-issue`.

Carried forward from prior handoffs, still relevant once `#575` wraps:

- **`#579`** (systemic `MongoTopologyClosedError` in shared e2e Mongo
  helpers) — still the most concrete next pickup after `#575`, blocking
  `#331`'s close.
- **`#331`** stays open pending `#579`.
- **`#368`** (tracking issue) stays open — `#575` was the piece that
  finishes it; check whether `#368` is now closeable once `#575` itself
  closes (per `resolve-issue`'s "check if a parent tracking issue is now
  closeable" step).
- **Skills-pack [`#279`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/279)**
  (dogfooding `issue-loop`'s blocked-item-skip mechanism) — still open,
  not touched this session, carried forward again. Don't let this one
  keep dropping.
- pack-repo `#280`/`#281`/`#283`/`#248`/`#270`/`#286` — unchanged, not
  checked this session.
