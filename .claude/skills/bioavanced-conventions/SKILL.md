---
name: bioavanced-conventions
description: Repo-wide conventions for BioAvanceD-v2 (Node/Express backend + React/Vite frontend + Playwright e2e) — repo layout, git hygiene, the ask-Dennis-first rules for working in Denise's repo, and the end-loaded Docker/CI gate order. Use for any change in this repo, not just test-loop iterations.
---

# BioAvanceD-v2 repo conventions

BioAvanceD-v2 is a biobank/lab management system: Node/Express backend
(`api/backend/`), React+Vite frontend (`frontend/`), Playwright e2e at the
repo root, MongoDB/Neo4j/Redis/InfluxDB via docker-compose. This skill
captures conventions that apply to *any* work here. For what to run and
when, see `testing-conventions`; for anything Docker, see
`e2e-docker-workflow`; for the test-building loop itself, see `test-loop`.

## This is Denise's repo — the hard rules

`deniseribeiro-beep/BioAvanceD-v2` belongs to Denise; Dennis contributes
with push access. Having credentials does not mean using them freely:

- **Never open a PR without Dennis's explicit go.** Do the work locally,
  push the branch when it's verified, then show Dennis the diff and wait.
  If a PR was opened by mistake, convert it to draft immediately:
  `gh pr ready --undo <number>`.
- **Never push to `main`.** All work lands via a PR that Dennis approves
  and merges — the merge is his decision every time.
- **Don't file GitHub issues without Dennis's explicit OK.** `gh issue
  create` is a visible write to Denise's repo. Use `.claude/issues/`
  instead (see below) for anything that needs tracking — that's a local
  git-tracked file, not a write to her repo, so it needs no separate
  sign-off. Only promote a local issue to GitHub when Dennis says to.

## Local issue tracking — `.claude/issues/`

This repo's findings/backlog live in `.claude/issues/` (see its own
`README.md` for the full format), not on Denise's GitHub Issues by
default. Two GitHub issues (#3, #5) are mirrored there as
`0003-*.md`/`0005-*.md` for continuity with work already tracked
upstream; everything discovered during the test-building push should be
filed there first. `test-loop`, `ship-to-main`, and `testing-conventions`
all point here for "where do I file/read a finding" — read the README
once per session rather than re-deriving the convention.

## Repo layout — three npm roots

- **Repo root** — holds `@playwright/test` and `playwright.config.ts`
  (they MUST stay at root — see `e2e-docker-workflow`'s module-resolution
  gotcha), the e2e specs in `tests/e2e/`, root-level vitest
  (`test:browser:*`), and all `docker:*`/`dev:*` compose scripts.
- **`frontend/`** — the React/Vite app. Has `typecheck`/`typecheck:full`
  scripts; no test script of its own.
- **`api/backend/`** — Express server. Tests live in
  `api/backend/tests/{unit,integration,compliance}` (vitest + a legacy
  fixed-list `run-tests.js` runner — see `testing-conventions` for the
  trap there).

Run `npm install` at root AND `npm --prefix frontend ci` AND
`npm --prefix api/backend ci` when setting up — the three roots don't
share `node_modules`.

## Git hygiene

- Create a branch per logical unit of work **before the first Edit/Write
  call**, not just before the first commit. Never work directly on
  `main`. Existing naming: `feature/<slug>` (e.g.
  `feature/docker-e2e-backend-integration`); use `test/<slug>` for
  test-loop slices if a new branch is needed.
- Commit every finished slice before starting the next one. Don't batch
  unrelated changes into one commit or leave uncommitted work lying
  around between iterations.
- Pushing the feature branch is cheap and does NOT trigger CI —
  `.github/workflows/ci-pipeline.yml` fires only on push/PR to `main`
  (deliberately restricted in 17f35eba until the docker e2e plumbing is
  ready). Iterate freely on the branch; the PR to `main` is where the
  real CI signal comes from (see `ship-to-main`).

## The gate order is end-loaded — same pattern that worked in helion-v2

Docker and CI are expensive, slow gates, not per-iteration tools. The
fixed order for the test-building push:

1. **Per iteration:** native, targeted test runs only (see
   `testing-conventions`). No `docker compose build`, no e2e-docker, no
   CI.
2. **End of the loop, once:** full native suites, then the one-time
   Docker gate (backend/frontend test containers + real-backend e2e) —
   see `ship-to-main`.
3. **Then CI:** push the branch, stop for Dennis, PR to `main` on his go.

Don't run the Docker gate after finishing an individual slice "just to
be sure" — that's exactly the per-iteration cost this order exists to
avoid.

## No lazy fixes

Don't silently patch a crash, add a skip-flag, or work around a missing
env var to keep moving. The backend startup crash on missing
`RESEND_API_KEY`/`CONSENT_SECRET` (2026-06, see `e2e-docker-workflow`)
was a real bug that needed lazy *initialization* in the service, not a
quiet env-var band-aid — the test is "would the next developer stumble
on this same crash?" If yes, it's a finding to surface (and, with
Dennis's OK, an issue), not a workaround to bury. `wrap-up`'s first
checklist item audits for exactly this.

## Verifying delegated (subagent) work

When a subagent reports tests written/passing, re-run the actual test
command yourself before committing or reporting the slice done. A
transcript summary claiming green is not verification — helion-v2 hit a
case where a subagent's "clippy/tests green" claim hid five compile
errors. Run the same commands you'd run for your own work. If a
subagent's result comes back as a stub or incomplete, resume it with
`SendMessage` (same agent, full context) — never spawn a fresh `Agent`
for a task one is already running on.

## Wrapping up

When whichever workflow skill is driving the task finishes, run
`wrap-up` before writing the final summary — treat "I'm about to write
the summary" as the trigger. If any of *these* conventions turned out
wrong or missing, that goes in the wrap-up report too, not just a
silent edit here.

## Maintaining this skill

If you repeatedly fumble something about this repo beyond what's written
here, update this file rather than working around the gap — that's the
point of it existing. Testing-process lessons go in
`testing-conventions`; Docker lessons in `e2e-docker-workflow`.
