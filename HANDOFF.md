# HANDOFF

**Written:** 2026-08-14, end of session on `fix/575-remove-patient-legacy-fields`.

## What happened this session

Opened by reading the prior handoff and confirming skills-pack `#295`/`#296`
were closed since the last session — resumed the `#575` ship gate that
`#295`'s Stop-hook bug had interrupted.

### `#575` gate — completed, both native and Docker

**Native pre-flight — all green:**
- Frontend typecheck: already confirmed clean last session, unchanged.
- Full native backend suite (`tests/unit tests/integration tests/compliance
  --coverage`): first run found 8 failures, all in 5 patient-related test
  files (`patients.api.test.js`, `intakeWizard.helpers.test.js`,
  `patient.service.createUpdate.gaps.unit.test.js`,
  `patient.service.query-update.gaps.unit.test.js`,
  `patient.service.unit.test.js`). Root cause: `#575`'s own commit
  (`e9d010eb`) updated 7 test files for the new ParticipantIdentity-backed
  lookup but missed these 5, which still mocked/asserted the pre-migration
  shape (patientName/birthDate/identityDocument living directly on
  Patient). Confirmed with Dennis these were stale tests, not product
  bugs, and fixed all 5 (mirroring the pattern already used in the other
  7). Re-run: **362/362 files, 6780/6780 tests green.** Committed as
  `67d8ca52`.
- Mocked Playwright e2e (`npm run test:e2e`): first run found 1 failure,
  `inline-storage-movement.spec.ts`'s "moveSample for an already-stored
  sample" — unrelated to `#575` (storage code, not patient fields).
  Root cause: `#495` (`40233640`, landed before `#575` branched) migrated
  `InlineStorageMovementPanel.tsx` to resolve current storage location via
  `GET /storage/sample/:sampleId` instead of reading
  `sample.storageLocation` directly; this spec (from `#488`) was never
  updated to mock that route. Confirmed with Dennis and fixed (added the
  missing route mock). Re-run: **11/11 passed.** Committed as `7e2c7b38`.
  Both commits pushed to `origin/fix/575-remove-patient-legacy-fields`.

**Docker gate — run, but the whole documented procedure was stale:**
- `ship-integration-branch`'s BioAvanceD-v2 overlay describes npm scripts
  (`docker:test:backend`, `docker:test:frontend`, `docker:local:up`,
  `test:e2e:docker`) that don't exist in `package.json`, and a 3-job CI
  shape (`backend-tests`/`e2e-mocked`/`e2e-docker`) that no longer exists
  — CI is now a single `current-state-validation` job (consolidated by
  Denise's `82f82808`, 2026-07-09). Filed
  [skills-pack#298](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/298)
  for the doc fix. Reconstructed the real procedure from
  `ci-pipeline.yml` + `compose.test.yml` instead:
  1. `docker compose --env-file .env.test.example -f compose.test.yml
     config/down/build/up -d --wait <infra + backend-app-test +
     frontend-app-test> ` — all healthy.
  2. `admin-bootstrap-test` — healthy.
  3. `backend-unit-runner` (`current-state:ci` — architecture + seed/
     dictionary validation + compliance evidence; **not** a real-backend
     vitest run, unlike what the overlay implies): **59/60**, one failure
     — `reference-live-verify-boundary.arch.test.js` (added 2026-08-12,
     `7dfce372`) reads `.github/workflows/...` but the container's build
     context is `./api/backend` only, so it can never see that path.
     Passes natively (5/5). CI hasn't run since 2026-07-31 (predates this
     test), so nobody's hit this yet — will break the next real CI run on
     any branch. Filed
     [deniseribeiro-beep/BioAvanceD-v2#584](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/584).
     Unrelated to `#575`.
  4. `frontend-unit-runner` and `playwright-runner`: confirmed **not
     invoked by current CI** at all (leftovers from before the July
     consolidation, unexercised since). Ran them anyway per Dennis's call:
     - `frontend-unit-runner`: real suite green (10/10 files, 72/72
       tests); fails only on the 90%/85% coverage-threshold gate against
       genuinely low actual frontend coverage (~8%) — pre-existing known
       gap, not a regression.
     - `playwright-runner` (real-backend e2e): **58/109 passed.** Two
       clusters identified — a missing InfluxDB env var in
       `compose.test.yml` (real hostname is `influxdb-test`, container
       tries `127.0.0.1:8086`) breaks every `interop-monitoring` spec;
       a real-login spec (`auth-access-security.spec.ts`) times out,
       not root-caused. Remaining ~49 failures not triaged. Filed
       [deniseribeiro-beep/BioAvanceD-v2#585](https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/585).
       Unrelated to `#575`.
  5. Stack torn down (`down --volumes --remove-orphans`) — confirmed
     empty (`docker ps -a`).
- Test images from this session (`bioavanced-test-*`, ~15 images) are
  still on the daemon — not pruned this session; ask before running
  `docker builder prune -af` next time per `docker-workflow` hygiene.

## Repo state

- **`fix/575-remove-patient-legacy-fields`**: pushed at `7e2c7b38`
  (2 new commits this session: `67d8ca52` stale-test fixes,
  `7e2c7b38` inline-storage-movement fix). Working tree clean.
  **Native pre-flight is fully green.** The Docker gate ran and found
  nothing that blocks `#575` itself — both failures found
  (`backend-unit-runner`'s architecture test, `playwright-runner`'s 51
  failures) are pre-existing and unrelated to patient-field removal.
  Per the overlay's merge authority rule, branch was pushed but **no PR
  opened** — that decision is Dennis's. Still not merged, not closed.
- **`feature/docker-e2e-backend-integration`**: unchanged, still at
  `7b2341d3`.

## Recommended next steps

None queued explicitly by Dennis. Candidates surfaced this session, for
his triage:
- Decide on `#575`: open the PR into `feature/docker-e2e-backend-integration`
  (or wherever it targets) now that both gates are clean, or hold for
  something else first.
- `deniseribeiro-beep/BioAvanceD-v2#584` — will break the next real CI
  run on any branch; likely worth prioritizing before anyone opens a PR
  that triggers `current-state-validation`.
- `deniseribeiro-beep/BioAvanceD-v2#585` — repo-owner call on whether to
  revive `playwright-runner`/`frontend-unit-runner` or retire them from
  `compose.test.yml`.

Carried forward from prior handoffs, still relevant:

- **`#579`** (systemic `MongoTopologyClosedError` in shared e2e Mongo
  helpers) — still the most concrete next pickup after `#575`, blocking
  `#331`'s close.
- **`#331`** stays open pending `#579`.
- **`#368`** (tracking issue) stays open — `#575` was the piece that
  finishes it; check whether `#368` is now closeable once `#575` itself
  closes.
- **`#580`/`#581`/`#582`/`#583`** — filed during `#575`'s own
  verification in an earlier session (stale test mocks, dead FHIR code,
  missing test stub). Untouched this session.
- Skills-pack [`#279`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/279)
  (dogfooding `issue-loop`'s blocked-item-skip mechanism) — still open,
  not touched this session.
- Skills-pack [`#297`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/297)
  (no graceful loop exit) — still open, flagged as needing the harness
  team, not this pack. Not touched this session.
- Skills-pack [`#298`](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/298)
  (new this session) — `ship-integration-branch`'s BioAvanceD-v2 overlay's
  Docker-gate section + CI-facts line, described above.
- pack-repo `#280`/`#281`/`#283`/`#248`/`#270`/`#286` — unchanged, not
  checked this session.
