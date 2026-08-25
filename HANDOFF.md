# HANDOFF

**Written:** 2026-08-25 (mid-sitting rotation, after #744; gate in flight). **Still inside
a rabbit hole** (tracker **#725**). Dennis said "Docker is on, continue
rabbit hole" without ruling on #723's Definition of Done, so this sitting
is landing the gate blockers (#744, #745, #746, #747 -- all done) to make
#723's gate literally green under either reading, then closing #723,
then #743, then #725.

## Rabbit-hole state

Tracker: **#725**, open. Members closed across all sittings: #724, #726,
#727, #728, #730, #737, #742, and this sitting **#744**, **#745**,
**#746**, **#747**.

This sitting so far (~7 of ~10 pacing points):

- **#745** (`d27c74e3`) -- `seedActiveTerminologyConcept` now stamps the
  real releases it supersedes and cleanup restores them; no more hand
  repair of HPO/ORPHA/ICD10/OMIM after `intake-wizard.spec.ts`.
- **#746 + #747** (`6f4492df`) -- `intake-wizard.spec.ts` is 6/6 green on
  two consecutive live runs. #746: generated checksum-valid unique CPF
  (`tests/e2e/helpers/cpf.ts`) instead of the fixed `11144477735`. #747
  (filed and closed in the same slice): with that 409 gone the submission
  still 409'd from `resolveAutomaticLocation` -- the block seeded no
  StorageBox and had been living on another spec's debris until #730's
  cleanup wiring removed it; it now seeds and releases its own. The
  submission assertion also reports status + body now, so the next
  rejection names itself instead of reading as a bare `false`.

- **#744** (`49ca8eac`) -- `inline-storage-movement.spec.ts` now mocks
  `GET /samples/:id/files` (`SampleFilesSection`, mounted by #647 after
  #611's mock list); 4/4 in both mocked and live-stack modes. Re-checked
  `SampleDetailsPage.tsx`: no other unmocked mount-time call remains.

Remaining, in order:

- **#723** -- specs merged (`d0e6d1ec`), last gate 193/200. Once #744
  lands: **the full single-worker gate is running now** (log:
  `$TEMP/claude/gate.log`); close #723 with its numbers. If this sitting
  ended before it finished, just rerun it -- the stack is up and all four
  blockers are merged. Dennis never had to rule on the
  "green modulo filed failures" question -- landing #745/#746/#747/#744
  makes it moot.
- **#743** -- Wave 4 showcase reel (RF008 `/reports` → export, RF013
  `/backup`), per `e2e-showcase-video`. Not started; needs the stack.

Then #725's upward-cascade check and close it naming every member above.

Per-item discipline that bit this sitting: each popped item needs its
routed loop skill (`test-loop` here) invoked via the Skill tool **before
its first edit** -- the edit gate is per-issue-number and blocks
otherwise (filed as pack #405).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed, up to date with
  origin @ `6f4492df` plus this rotation. No fix/test branches left.
- **Docker stack is UP** (brought up this sitting with `--build`):
  `compose.test.yml` core services + `admin-bootstrap-test` +
  `foundation-bootstrap-test` + all 16 `reference-data-bootstrap-*-test`
  (every one-shot `Exited (0)`), `playwright-runner` stopped. The four
  real reference releases are `active`.
- Host Playwright run against it (per-spec or full gate):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward again.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Filed this sitting (not queue members)

BioAvanceD-v2: none beyond #747 (which became a queue member and closed).
Skills-pack: #406 (`npx tsc` at the repo root runs a prank package and
exits 0 -- a filtered-output check reads as a clean typecheck; use `npm
run typecheck` or `node frontend/node_modules/typescript/bin/tsc`), #404 (docker-workflow overlay's "known gate failures as of
2026-08-25" paragraph + #745 hand-repair recipe now stale), #405
(rabbit-hole re-entry doesn't say to invoke the routed loop skill per
popped item; edit gate blocks).

## Recommended next steps

1. #744 (small, test-only).
2. Full gate rerun → close #723.
3. #743 showcase reel.
4. Close #725.
