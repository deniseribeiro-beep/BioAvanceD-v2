---
name: testing-conventions
description: BioAvanceD-v2 testing & verification conventions — test tiers and where tests live, what to run per iteration vs. at the end, the fixed-list test-runner trap, known pre-existing failures, and how to debug Playwright e2e fast. Use for any change that adds or touches tests, alongside bioavanced-conventions.
---

# BioAvanceD-v2 testing & verification conventions

For repo layout, git hygiene, and the end-loaded Docker/CI gate order,
see `bioavanced-conventions` — read both for any test work. For anything
Docker-specific, see `e2e-docker-workflow`.

## Test tiers — where tests live

- `api/backend/tests/unit/` — backend unit tests.
- `api/backend/tests/integration/` — backend integration/API tests
  (supertest against the app imported directly; `NODE_ENV=test` means
  the server does NOT auto-listen — see `e2e-docker-workflow`).
- `api/backend/tests/compliance/` — compliance/contract tests + evidence
  generation.
- Repo-root `tests/e2e/*.spec.ts` — Playwright specs (currently
  `backend-integration`, `cadastro-amostra`, `intake-wizard`,
  `tcle-dinamico`). Config is root `playwright.config.ts`; `testDir`
  resolves relative to the config file, not the cwd.

**Do NOT run the root `test:browser:*` scripts as they stand.** There is
no vitest config at the repo root, so root `npx vitest run` sweeps up
`api/backend/tests/**` (143 files) but without backend's
`vitest.setup.js` env — verified 2026-07-02: 23 spurious failures
(`secretOrPrivateKey must have a value` etc.) that pass when run from
`api/backend/` properly. Broken plumbing, not real failures — it needs
either a root vitest config scoping what it should test or removal of
the scripts (surfaced to Dennis; fits issue #3's "fix broken test
plumbing" scope). Until fixed, backend tests run from `api/backend/`
only.

## What to run per iteration (native only — no Docker)

- Backend slice: `npx vitest run <path/to/new.test.js>` from
  `api/backend/` — targeted first, then the full backend
  `npx vitest run` before committing the slice.
- New/changed e2e spec: run it alone first —
  `npx playwright test tests/e2e/<spec>.spec.ts --reporter=list` — and
  only run the full suite after the individual spec passes. A full run
  per iteration wastes minutes and blurs whether a failure is the new
  spec or shared-state interaction.
- Frontend-touching changes: `npm --prefix frontend run typecheck` (no
  frontend test script exists yet — if one gets added, record it here).

## `vi.mock()` does not intercept `require()`

Confirmed independently twice (2026-07-02, `scheduler.service.test.js` and
`sendConsentEmail.test.js`): in this repo's Vitest setup, `vi.mock('./x', ...)`
only intercepts ES `import`/dynamic `import()` of `x`. Backend source files
overwhelmingly use CommonJS `require(...)`, which `vi.mock` does not hook —
the mock factory silently never runs and the real module executes underneath
it (real logger, real timers, real network calls). Symptom: mocked functions
report zero calls even though the code path clearly ran.

Workaround, not a fix — Node's CJS module cache guarantees the test file and
the source file under test share the same object instance, so: `require` the
real singleton module and use `vi.spyOn(realModule, 'methodName')` /
`.mockImplementation(...)` directly on it, restoring with
`vi.restoreAllMocks()` in `afterEach`. This applies to the module's own
dependencies too (e.g. a service's internal `require('node-cron')` or
`require('../utils/logger')`) — spy on the dependency's exports the same way
rather than trying to `vi.mock` the dependency's module path.

**`vi.spyOn` also silently fails if the source file destructures the import**
(confirmed independently 3x, 2026-07-02: `RegisterSample.js`, `authConsent.js`,
`iot-streaming.service.js` — all do `const { getCollection } = require(...)` /
`const { getQueue } = require(...)` at module scope). Spying on the exporting
module's method after that destructuring has already run has no effect — the
local binding still points at the original function, so the spy is silently
never called and the real implementation runs underneath it. Symptom looks
identical to the `vi.mock`/`require` gap above (zero calls recorded on a mock
that should have fired) but the root cause is different and the module-object
spy trick above does not fix it. Workaround: stub the *lower-level* call the
destructured helper itself makes (e.g. `db.collection()` instead of
`getCollection()`), or clear `require.cache` for both the dependency and the
module under test and re-require after setting the spy so the destructuring
re-runs against the mocked export.

## The fixed-list runner trap

`api/backend`'s `test:ci` and `tests/run-tests.js` are a **fixed list of
require'd files** — a new test file under `tests/integration/` or
`tests/unit/` is silently NOT picked up by them. Only a bare
`npx vitest run` discovers new files; CI was updated to call
`npx vitest run --reporter=verbose` directly for this reason. Every time
you add a backend test file, confirm it actually executed in the output
— a green run that never loaded your file is the classic false positive
here.

## Dev machine is Windows, CI is Linux — watch OS-specific commands

This repo is developed on Windows but `.github/workflows/ci-pipeline.yml` runs
all jobs on `ubuntu-latest`. A test that shells out to Windows-only tools
(`taskkill`, `findstr`, etc. — see issue #7 for `portManager.js`) will pass
locally and fail on CI with no signal until the PR runs. When a new test
exercises real OS processes/commands rather than mocking them, check whether
the code under test is itself cross-platform before trusting a green local run
as CI-green.

## Known pre-existing failures (don't chase, don't hide)

`tests/compliance/compliance.contract.test.js` has 2 AES-256-GCM
failures (as of 2026-06-30): `ENCRYPTION_KEY` env format is wrong for
the test context, `encryptValue` returns `null`. They predate the test
push — don't treat them as regressions from your change, and don't
skip/delete them to make a run look clean. No dedicated tracking issue
is confirmed to exist for them (as of 2026-07-02 only #3/#5 are open) —
if you touch this area, remind Dennis rather than filing one yourself.
If they get fixed, remove this entry.

## Mocked vs. real-backend e2e

- `npm run test:e2e` — mocked mode; Playwright starts its own webserver.
  This is the per-iteration-safe mode.
- `npm run test:e2e:docker` — sets `PLAYWRIGHT_SKIP_WEBSERVER=1` and
  expects a live stack at `localhost:5173`/`localhost:3000`. This is the
  end-of-loop Docker gate only (see `ship-to-main`), never a
  per-iteration run.
- Real login against a live backend already exists:
  `frontend/playwright/global.setup.ts` honors
  `PLAYWRIGHT_USE_REAL_LOGIN=1` + `TEST_USER`/`TEST_PASS`. Reuse it —
  don't build a second auth mechanism for real-backend specs.

## Debugging e2e failures fast

After a failed run, read `test-results/` directly — only failed tests
create result dirs, so the previous run already has the answer. Don't
re-run the whole suite with a JSON reporter just to find out what
failed. Playwright's HTML report lands in `playwright-report/` if you
need traces.

## Tests are honest or they're worthless

The point of the test-building loop is real coverage, not a number:

- No assertion-free or tautological tests to pad coverage. A test that
  can't fail isn't a test.
- Never weaken an assertion or add a skip to get a run green. A failing
  test either found a real bug (surface it — see `test-loop`) or is
  itself wrong (fix the test and say so).
- A regression found during implementation gets a *named* invariant test
  that would fail again if the bug came back.
- Every new validator gets happy-path + rejection cases; every new API
  seam gets an integration test at the tier it crosses.

## CI map (`.github/workflows/ci-pipeline.yml`)

Triggers on push/PR to `main` only (restricted in 17f35eba). Three jobs:

1. `backend-tests` — backend vitest (`npx vitest run --reporter=verbose`).
2. `e2e-mocked` — Playwright against the mocked backend.
3. `e2e-docker` — full docker-compose stack; writes `.env.docker` inline
   from CI values with **deliberately dummy passwords** (`ci-password`
   etc.) — never "fix" those to real credentials; they're throwaway
   values scoped to CI's ephemeral containers.

If a job or trigger changes, update this section — it's derived from the
workflow file as it exists today and will rot silently otherwise.

## Maintaining this skill

If a verification step here turns out wrong, stale, or missing something
you discovered the hard way, update this file directly, and surface the
gap in the session's `wrap-up` too — don't just silently edit.
