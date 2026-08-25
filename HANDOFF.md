# HANDOFF

**Written:** 2026-08-25 (mid-sitting rotation, after #745). **Still inside
a rabbit hole** (tracker **#725**). Dennis said "Docker is on, continue
rabbit hole" without ruling on #723's Definition of Done, so this sitting
is landing the three gate blockers (#745 done, #746 and #744 next) to make
#723's gate literally green under either reading, then closing #723,
then #743, then #725.

## Rabbit-hole state

Tracker: **#725**, open. Members closed across all sittings: #724, #726,
#727, #728, #730, #737, #742, and (this sitting) **#745** -- merged
`d27c74e3`, `seedActiveTerminologyConcept` now stamps the real releases it
supersedes and cleanup restores them; verified live, no more hand repair
of HPO/ORPHA/ICD10/OMIM after `intake-wizard.spec.ts`.

Remaining, in order:

- **#746** -- `intake-wizard.spec.ts` (#696 block) fixed CPF
  `11144477735` → 409 on a persistent volume. Test-only: generate a
  checksum-valid unique CPF per run. Not started. `test/<slug>` branch,
  `test-loop` route (invoke it via the Skill tool before the first edit
  -- the edit gate demands it per issue; pack #405).
- **#744** -- `inline-storage-movement.spec.ts` ×4: add
  `page.route('**/api/samples/*/files**')` → `{success:true,data:[]}`
  next to the other four background mocks in `openPanelForSample`.
  Confirmed this sitting that `/samples/:id/files` (from
  `SampleFilesSection`) is the only unmocked mount-time call on
  `SampleDetailsPage`. Not started.
- **#723** -- specs merged (`d0e6d1ec`), last gate 193/200. Once #746 and
  #744 land: rerun the full gate single-worker (recipe below), expect
  200/200, close #723 with the numbers.
- **#743** -- Wave 4 showcase reel (RF008 `/reports` → export, RF013
  `/backup`), per `e2e-showcase-video`. Not started; needs the stack.

Then #725's upward-cascade check and close it naming every member above.

Pacing: ~2 of ~10 points spent this sitting (#745).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed, up to date with
  origin @ `d27c74e3` plus this rotation. No fix/test branches left.
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

Skills-pack: #404 (docker-workflow overlay's "known gate failures as of
2026-08-25" paragraph + #745 hand-repair recipe now stale), #405
(rabbit-hole re-entry doesn't say to invoke the routed loop skill per
popped item; edit gate blocks).

## Recommended next steps

1. #746, then #744 (both small, test-only).
2. Full gate rerun → close #723.
3. #743 showcase reel.
4. Close #725.
