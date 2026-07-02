---
status: open
priority: P1
github: "#3"
opened: 2026-06-30
---

# Wire backend+frontend into Docker e2e, fix broken test plumbing, raise coverage

Mirror of https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/3 — umbrella
tracking issue for the whole test-building push. Keep this file's checklist in sync
with the GitHub issue if either changes.

## Problem

The e2e suite (`tests/e2e/*.spec.ts`, configured via `frontend/playwright.config.ts`)
currently only drives the frontend dev server and mocks every backend call with
`page.route(...)`. Backend tests (`api/backend/tests/{unit,integration,compliance}`)
run completely isolated via Vitest. CI (`.github/workflows/ci-pipeline.yml`) mirrors
this split — services spin up for the backend Vitest step, but the Playwright step
runs with no backend at all.

On top of the design gap, investigation found concrete breakage:

- `frontend/playwright.config.ts` sets `testDir: './tests/e2e'`, which resolves
  relative to the config file (`frontend/tests/e2e/`) — that directory doesn't exist.
  The real specs live at repo-root `tests/e2e/`. As configured, Playwright currently
  points at an empty directory. (Fixed on `feature/docker-e2e-backend-integration` —
  config now lives at repo root; see `e2e-docker-workflow` skill.)
- `package.json` references `scripts/start-local-stack.ps1`,
  `scripts/stop-local-stack.ps1`, and `docker-compose.test.yml` — none of these
  existed in the repo (status: added on the branch — verify still present).
- No production-style Dockerfile exists for backend or frontend (only
  `Dockerfile.dev`).
- None of the 3 existing e2e specs originally asserted against a real database —
  only mocked routes.

## Goal

Drive real backend + frontend together in Docker for e2e, fix the plumbing above,
raise backend/e2e coverage, and align CI to actually exercise this.

## Plan / checklist

- [x] Fix `frontend/playwright.config.ts` `testDir` to point at the real `tests/e2e`
      specs (moved to root `playwright.config.ts`)
- [x] Add `docker-compose.test.yml` override (backend-test/frontend-test services)
- [x] Add missing `scripts/start-local-stack.ps1` / `stop-local-stack.ps1`
- [ ] Add a Docker-aware Playwright config that points at the dockerized stack
      instead of mocking the backend (partially done — `test:e2e:docker` script
      exists; verify it's exercised end-to-end)
- [ ] Add real (non-mocked) e2e specs covering a core flow end-to-end (intake →
      sample → result) against the real DB
- [x] Run `vitest run --coverage` in `api/backend` to find weak spots among the
      route modules and add integration tests (~800 tests added, ~35% lines, see
      a732d820)
- [ ] Update `.github/workflows/ci-pipeline.yml` to add a docker-compose-based e2e
      job alongside the existing fast unit-test step (job exists; currently scoped
      with a `--grep` workaround — see 0005)
- [ ] Verify locally end-to-end (docker stack up, full suite green, docker stack
      down) before opening the implementation PR — this is `ship-to-main`'s job

## Notes

Root `npm run test:browser:run` was found broken during this push (see
`testing-conventions` skill) — sweeps `api/backend` tests without their env setup,
23 spurious failures. Fits this issue's "fix broken test plumbing" scope; not yet
fixed.
