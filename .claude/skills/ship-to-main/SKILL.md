---
name: ship-to-main
description: End-of-loop graduation for BioAvanceD-v2 — full native suites, then the one-time Docker gate (backend/frontend test containers + real-backend e2e), then push the branch and STOP for Dennis's review; the PR to main (opened only on his go) produces the real CI signal, and the merge is his decision. Use when the test loop is believed complete, or when asked to "ship", "graduate the branch", or "get this ready for CI".
---

# Ship the branch → main

This is the last phase of the test-building push — the point where the
deliberately-deferred Docker and CI gates finally run, once, in order.
Mirrors helion-v2's `ship-dev` procedure adapted to this repo's rules:
here the PR and the merge belong to Dennis, full stop.

**Read `bioavanced-conventions`' hard rules first** — never open the PR
or touch `main` yourself.

## Why this order

`.github/workflows/ci-pipeline.yml` triggers only on push/PR to `main`
(restricted in 17f35eba). Consequences:

- Pushing the feature branch never runs CI — there is nothing to "let
  CI check" before the PR exists.
- The PR to `main` is what runs the real suite (backend-tests,
  e2e-mocked, e2e-docker) against the merge result without moving
  `main` — that's the CI signal, and it comes only after Dennis says to
  open the PR.
- The local Docker gate below exists so the PR's e2e-docker job isn't
  the first time the stack ever runs against this branch — local is
  slower than unit tests but far faster than a round-trip through
  Actions.

## 1. Confirm the loop is actually done

Don't start this on a half-finished test push. Check the tracking
issues on GitHub (`gh issue list --state open` on
`deniseribeiro-beep/BioAvanceD-v2` — #3 and #5 are the umbrella issues
as of this writing, read their checklists, not just their titles)
against what the branch actually delivers, and `git status` for
uncommitted leftovers. If real slices remain, that's `test-loop`'s
job — go back rather than shipping a partial batch.

## 2. Full native pre-flight

1. `npx vitest run` from `api/backend/` — full backend suite (bare
   vitest, NOT `test:ci` — see `testing-conventions`' fixed-list trap).
   The 2 known pre-existing compliance failures are expected unless
   they've since been fixed; anything else red gets fixed first.
2. `npm --prefix frontend run typecheck`.
3. `npm run test:e2e` — full mocked Playwright suite.

(Do NOT run root `test:browser:run` — broken plumbing, see
`testing-conventions`' warning: it re-runs the backend suite from the
wrong root without its env setup and fails spuriously.)

Fix everything red natively before touching Docker — don't use the
Docker gate as your test runner.

## 3. The one-time Docker gate

Follow `e2e-docker-workflow` for setup (`.env.docker`, Docker Desktop
actually reachable) and every known gotcha before running:

1. `npm run docker:test:backend` — backend suite inside the compose
   test service (vitest against real Mongo/Neo4j/Redis containers).
2. `npm run docker:test:frontend`.
3. Real-backend e2e: bring the stack up (`npm run docker:local:up`),
   confirm backend and frontend actually listen (see
   `e2e-docker-workflow`'s `NODE_ENV=test` and startup-crash gotchas),
   then `npm run test:e2e:docker`.
4. On failure: read `test-results/` for the failing spec, fix forward
   on the branch, and re-run only the failed piece before repeating the
   full gate.
5. Tear the stack down (`npm run docker:local:down`) when green.

## 4. Push, then stop

Push the branch (`git push -u origin <branch>`). **Do not open a PR.**
Present Dennis the summary: what the branch delivers, the native and
Docker gate results, coverage numbers if measured, and anything
`wrap-up` surfaced — then wait for his review.

On his explicit go: open the PR to `main`, watch `gh pr checks`, fix
forward on the branch if CI is red. The merge itself is his decision —
don't merge on green, don't nudge for it.

## 5. Wrap up

Run `wrap-up` before the final report — gate surprises, permission
denials, stale steps in this file, anything that didn't match what this
skill promised.

## Maintaining this skill

This file is derived from `ci-pipeline.yml` and the root `package.json`
scripts as they exist today — if the CI triggers, jobs, or docker/test
scripts change, update it or it rots silently.
