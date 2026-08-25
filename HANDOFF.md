# HANDOFF

**Written:** 2026-08-25 (end of sitting). **Exited the rabbit hole** --
tracker **#725 is closed**, every member resolved. Dennis said "Docker is
on, continue rabbit hole"; the sitting landed the four gate blockers, took
the full e2e gate to **200/200 green** (the first literally-green full
gate on this branch), closed **#723** without needing his DoD call, and
recorded the Wave 4 showcase reel.

## What closed this sitting

- **#745** (`d27c74e3`) -- `seedActiveTerminologyConcept` stamps the real
  releases it supersedes; cleanup restores them. No more hand repair of
  HPO/ORPHA/ICD10/OMIM after `intake-wizard.spec.ts`.
- **#746 + #747** (`6f4492df`) -- `intake-wizard.spec.ts` 6/6. #746:
  generated unique checksum-valid CPF (`tests/e2e/helpers/cpf.ts`). #747
  (filed and closed in the same slice): the #696 block now seeds and
  releases its own StorageBox instead of living on another spec's debris.
  The submission assertion also reports status + body now.
- **#744** (`49ca8eac`) -- `inline-storage-movement.spec.ts` mocks
  `GET /samples/:id/files`; 4/4 mocked and live.
- **#723** -- closed on the 200/200 gate (16 files, 2.2 min, `--workers=1`).
- **#743** (`0d7681ac`) -- Wave 4 showcase reel,
  `docs/e2e-showcase-2026-08-25.mp4` (46.9s): login -> `/reports/templates`
  (template created live) -> `/reports` -> CSV export -> `/backup` run +
  policy edit. 1/1 green.
- **#725** -- tracker closed with the full member list (13 members across
  all sittings).

All changes were test-only or docs; no product source was touched.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed, up to date with
  origin @ `6d5d676a` plus this rotation. No fix/test branches left (all
  merged `--no-ff` and deleted).
- **Docker stack is UP** and healthy: `compose.test.yml` core services +
  `admin-bootstrap-test` + `foundation-bootstrap-test` + all 16
  `reference-data-bootstrap-*-test` (each `Exited (0)`),
  `playwright-runner` stopped. Tear it down if the next sitting doesn't
  need it (`compose down`, no `-v` -- keep the named volumes).
- Volume hygiene verified after the full gate: the four real reference
  releases still `active`, `storageBoxes` back to 0, no `e2e-696-*` rows.
  Nothing needs hand repair anymore.
- Host Playwright run against the stack (per-spec, full gate, or the
  showcase config):
  `PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123 E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true" E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test [spec] --workers=1`
- **Don't use `npx tsc` in this repo** -- the root has no `typescript`
  dep, so npx fetches an unrelated prank package that prints a banner and
  exits 0 (a filtered grep of its output reads as a clean typecheck). Use
  `npm run typecheck`, or
  `node frontend/node_modules/typescript/bin/tsc --noEmit -p <config>`.
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward again.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Filed this sitting, still open

BioAvanceD-v2: nothing new beyond #747 (which closed in the same slice).
Findings from earlier sittings remain open and unblocked: #732, #733,
#734, #735, #738, #739, #740, #741, #729.

Skills-pack: #404 (docker-workflow overlay's "known gate failures" list
and the #745 hand-repair recipe are now stale), #405 (rabbit-hole
re-entry doesn't say to invoke the routed loop skill per popped item),
#406 (`npx tsc` false green), #407 (a long close comment can be lost
silently; plus a gate false positive matching heredoc content).

## Recommended next steps

None queued -- Dennis hasn't named the next piece of work. Natural
candidates if he wants one: the open BioAvanceD-v2 findings above (#739
and #738 are the most substantive), or `ship-integration-branch` to
graduate `feature/docker-e2e-backend-integration` to `main` now that the
full gate is green -- that one needs his explicit go, since it means a PR.
