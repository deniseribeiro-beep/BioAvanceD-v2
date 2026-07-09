---
name: e2e-docker-workflow
description: Notes on running this repo's Docker-based e2e stack (backend + frontend + Playwright). Committed to the shared repo (as of 2026-07-02). Use to recall setup steps and known gotchas before/while working on e2e or docker-compose changes.
---

# Docker e2e workflow notes

Tracking issue: https://github.com/deniseribeiro-beep/BioAvanceD-v2/issues/3
Branch: feature/docker-e2e-backend-integration

This is the single source of truth for Docker/compose/CI infra in this
repo — anything about running the stack (setup, compose services, env
vars, Windows gotchas) lives here, not duplicated into the other skills.
Playwright *spec-authoring* concerns (selectors, config/module-resolution
gotchas, mocked auth, frontend-behavior surprises) live in
`playwright-specs` instead — this skill only covers what's needed to get
the stack itself running. Where it fits: `bioavanced-conventions` sets
the end-loaded gate order (no Docker per iteration), `test-loop` is the
native per-slice loop, and `ship-to-main`'s one-time Docker gate is what
actually consumes this skill's setup checklist and gotchas. When a
session that used this skill finishes, run `wrap-up` before the final
summary; new Docker/infra lessons get appended to the gotchas below —
new Playwright spec/config lessons go in `playwright-specs` instead.

## Setup checklist
1. Docker Desktop must be running (`docker version` must reach the engine, not just the CLI).
2. Copy `.env.docker.example` -> `.env.docker` and fill in real values. Never commit `.env.docker`.
3. Playwright config lives at repo root (`playwright.config.ts`), not under `frontend/` — see `playwright-specs` for the module-resolution reason why.
4. `npm install` at repo root (for `@playwright/test`) AND `npm --prefix frontend ci` AND `npm --prefix api/backend ci`.

## Gotchas

### `package.json` referenced files that didn't exist (as of 2026-06-30)
`scripts/start-local-stack.ps1`, `scripts/stop-local-stack.ps1`, `docker-compose.test.yml` were
all referenced by npm scripts but missing from the repo. If `npm run docker:local:up` or
`npm run docker:test:backend` fail with "file not found", check these still exist — they may have
been added by this branch's work; if missing again, something deleted them.

### Backend `NODE_ENV=test` does not auto-start the server
`api/backend/server.js` only calls `startServer()` when `NODE_ENV !== 'test'`. Test files
import the app directly. Keep this in mind if a docker-compose test service appears to start but
nothing listens on the port — check what `NODE_ENV` the container actually got from `.env.docker`.

### `tests/compliance/compliance.contract.test.js` has 2 pre-existing failures (as of 2026-06-30)
Two AES-256-GCM encryption tests fail because the `ENCRYPTION_KEY` env var format is wrong for the
test context (returns `null` from `encryptValue`). These failures predate this branch and are NOT
caused by our changes. Track separately — see the compliance test file around lines 92–110.

### `api/backend/package.json` `test:ci` script does NOT auto-include new test files
`tests/run-tests.js` is a fixed-list require-based runner. New files added under `tests/integration/`
or `tests/unit/` are only picked up by a bare `npx vitest run`, not by the legacy `test:ci` script.
CI was updated to use `npx vitest run --reporter=verbose` directly.

### CI e2e-docker job writes `.env.docker` inline with hardcoded CI passwords
The inline `.env.docker` in `.github/workflows/ci-pipeline.yml` uses dummy passwords
(e.g., `ci-password`, `ci-neo4j-password`). Never replace these with real production credentials —
they must stay as throwaway values scoped to CI's ephemeral docker containers.

### This is Denise's repo — be very conservative with push/PR actions
`deniseribeiro-beep/BioAvanceD-v2` belongs to Denise, not Dennis. Having credentials/push
access doesn't mean we should use them freely. Always do work locally, show Dennis the diff,
and only push or open PRs when he explicitly says to. If something was pushed/opened by
mistake, convert the PR to draft immediately: `gh pr ready --undo <number>`.

### `npm run seed` doesn't exist yet — it's in progress on another branch, don't reinvent it
`scripts/start-local-stack.ps1` and `tests/e2e/backend-integration.spec.ts` both assume a
`npm run seed` script creates a known admin user, but neither root nor `api/backend/package.json`
has one (confirmed 2026-07-09, filed as issue #144). Before adding one yourself, check
`origin/chore/reference-seed-stack-and-ci` — it has active commits aligning a reference seed + CI
contract — and `origin/release/inpi-v1.1.0-rcs-gov`, which already has a working `seed` script in
both package.jsons. Real-backend/login-driven e2e specs should wait on or pull from that branch's
seed work rather than a second seed mechanism getting built here.

### Backend crashes on startup with missing RESEND_API_KEY and CONSENT_SECRET
Two services (`sendCriticalAlertEmail.js`, `sendIncidentAlertEmail.js`) called `new Resend(key)`
at module load time — throws immediately if `RESEND_API_KEY` is empty/unset even though the
function already checks the key before actually sending. Fixed by lazy-initializing with a
`getResend()` wrapper. `CONSENT_SECRET` is also required at startup (checked in `eConsent.js`
line 15) — must be in `.env.docker` even for dev/test. Added both to `.env.docker`.

<!-- Add new gotchas above this line as they're discovered. Keep each entry: what broke, why, the fix. -->
