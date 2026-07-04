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
backend tests without backend's `vitest.setup.js` env and fails
spuriously — broken plumbing, not real failures (verified 2026-07-02,
23 spurious failures; surfaced to Dennis, fits issue #3's scope —
incident `root-vitest-spurious-failures`,
`bioavanced-conventions/references/incidents.md`). Until fixed,
backend tests run from `api/backend/` only.

## Finding gaps without a full coverage run

`api/backend/COVERAGE_NOTES.md` is a committed snapshot of per-file line
coverage (buckets: ZERO/LOW/MID/GOOD), meant to replace running
`npx vitest run --coverage` at the start of every session just to find
the next gap. Read it to pick a slice; update the file in the same
commit as the slice that closes a gap it lists. Only regenerate it with
a real coverage run at the `ship-to-main` gate or when it looks stale —
see the file's own header for the regenerate command and cadence.

## What to run per iteration (native only — no Docker)

- Backend slice: `npx vitest run <path/to/new.test.js>` (or all the
  slice's new files together) from `api/backend/` — targeted only, no
  full-suite run before committing. The backend suite is now in the
  thousands of tests and a full run per iteration is too slow to pay on
  every slice; committing on a green targeted run is enough signal for
  one iteration. The full native suite runs once, at the coverage-phase
  gate (see `test-loop`'s "Ending an iteration" / the reconcile step in
  `COVERAGE_NOTES.md`), not per iteration.
- New/changed e2e spec: run it alone first —
  `npx playwright test tests/e2e/<spec>.spec.ts --reporter=list`. Don't
  run the full e2e suite per iteration either — same reasoning as
  backend above.
- Frontend-touching changes: `npm --prefix frontend run typecheck` (no
  frontend test script exists yet — if one gets added, record it here).

## Per-file `--coverage.include=<one file>` can under-report — sanity check before trusting it

Observed on `MongoStorageRepository.js` (2026-07-04): running just its test
file with `--coverage --coverage.include=src/.../MongoStorageRepository.js`
reported only 60% lines / 40% functions, with several lines inside
thoroughly-tested methods (e.g. `moveSamplePosition`'s unconditional
top-of-function lines) showing 0 hits — while reading the test file showed
happy-path and every error-branch already covered for those methods. Tried
lcov and json reporters, ran with a sibling test file added, and got the
same numbers both times, so it isn't a one-off flake. Root cause wasn't
tracked down (isolating it further wasn't worth the session budget); one
candidate not yet ruled out is CJS-via-ESM `import` interop (this file does
`import X from '../.../Foo.js'` on a CJS module, unlike the
require.cache-injection route/service tests elsewhere in this repo, where
the same single-file `--coverage.include` measurement has been reliable
release after release). If a file's isolated coverage number looks wrong
given what the test file actually exercises, don't trust it blindly —
either sanity-check against the next full `--coverage --reporter=basic`
reconcile, or note the discrepancy in `COVERAGE_HISTORY.md` instead of
recording a number you don't believe.

## Context economy — keep runner output out of the conversation

The suite is in the thousands of tests; unmanaged runner output is the
single biggest context sink in a loop session. Rules:

- **Single new test file:** default reporter is fine — you want to see
  every test name once to confirm the file was discovered (fixed-list
  trap below) and the assertions are real.
- **Multi-file runs** (fan-in verify of several slices together, re-runs
  of already-seen files): `npx vitest run <files> --reporter=dot`. You
  already reviewed the per-test detail on the individual runs; the
  combined run only needs pass/fail.
- **Full-suite runs** (coverage reconcile / ship-to-main gate only):
  never stream the output into the conversation. Redirect to a file in
  the scratchpad (or `api/backend/coverage/` — gitignored), then read
  back only the tail summary and grep the file for `FAIL`/`✗` if the
  summary shows failures. Same for full Playwright runs — and remember
  failed-run detail is already on disk in `test-results/`.
- **Reading sources under test:** read the file once, in full, when
  writing its tests (you need the real branch structure); but don't
  re-`Read` a test file you just wrote/edited, and don't cat large
  source files a second time to "double-check" a detail — grep the
  specific lines instead.
- The `COVERAGE_NOTES.md` / `COVERAGE_HISTORY.md` split exists for the
  same reason — read the notes, not the history, unless you need a
  specific past slice's narrative.

## CJS mocking gotchas — read the reference before mocking anything

The full, verbatim writeups (with incident history and workarounds) live
in `references/cjs-mocking.md` next to this file — **Read that file
before writing or briefing any test that mocks/spies/stubs**, and hand
its *path* to test-writer subagents instead of paraphrasing it into
briefs. Index of what it covers, so you know when it applies:

1. Test files are ESM-only (`import ... from 'vitest'`); CJS sources
   load via `createRequire(import.meta.url)`, never `require` of vitest.
2. `vi.mock()` does not intercept `require()` — spy on the real
   singleton module instead.
3. `await import(...)` of a CJS source yields a *different instance*
   than internal `require()`s — spies no-op; use `createRequire`.
4. `vi.spyOn` silently fails when the source destructured the import at
   module scope — stub lower, or clear `require.cache` and re-require.
5. `vi.resetModules()` doesn't clear Node's real `require.cache` —
   `delete require.cache[require.resolve(path)]` explicitly.
6. Testing a mongoose `pre('save')` hook without a DB connection —
   locate it in `Model.schema.s.hooks._pres.get('save')` by source-text
   match and invoke it directly against a plain document instance.

If any test doing mocking is in the slice, points 1-5 above are not a
substitute for the reference file — the workaround details matter.

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

## Legacy code — see the `legacy` skill

Whether a candidate file/slice is legacy (superseded, dead path,
mid-migration) shapes both slice-picking and how a hard-to-test failure
against it gets treated — see the `legacy` skill for the judgment call,
the known list of already-flagged legacy areas, and where to record a
new one. Don't duplicate that content here; if you flag something as
legacy while doing testing work, record it in the `legacy` skill's file,
not this one.

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
