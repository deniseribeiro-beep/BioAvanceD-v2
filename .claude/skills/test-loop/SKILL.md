---
name: test-loop
description: Per-iteration workflow for the AI test-building loop in BioAvanceD-v2 — pick the next test/CI/e2e gap, implement it natively (no Docker), verify honestly, commit, wrap up. Docker and CI are end-of-loop gates (see ship-to-main), not per-iteration tools. Use when asked to "work on tests", "raise coverage", "continue the test loop", or when driven by /loop.
---

# Test-building loop — one iteration

The repo is mid test-implementation push: wire up unit, integration,
and e2e coverage plus CI, with an AI agent looping through slices of
that work. This skill is one iteration of that loop. Read
`bioavanced-conventions` and `testing-conventions` first — this skill
covers the loop mechanics, not the conventions they already answer.

## Where the work is tracked

- GitHub Issues on `deniseribeiro-beep/BioAvanceD-v2` are the primary
  tracker — `gh issue list --state open` and read the umbrella issues
  (#3 `docker-e2e-wiring`, #5 `e2e-real-backend-specs` as of this
  writing). Check fresh each session — checklists get updated as slices
  land, don't trust memory of a prior session's state.
- The coverage push so far lives on
  `feature/docker-e2e-backend-integration` (unit+integration tests to
  ~35% lines in a732d820, e2e spec rewrites in 5a4a49d0). Continue on
  the existing branch unless the slice is genuinely unrelated to its
  scope.
- **File new findings with `gh issue create` freely** — Dennis gave
  blanket OK for this (2026-07-02), no per-issue sign-off needed
  (`bioavanced-conventions`' hard rules). Opening a *PR* still needs his
  explicit go — that rule is separate and unchanged.

## Before an iteration

1. `git status` — confirm a clean tree and which branch you're on;
   commit or flag any leftovers before starting.
2. `gh issue list --state open` — re-read the tracking issue(s) for
   scope that's already been delivered vs. still open.
3. Check `git log --oneline -5` vs `origin/<branch>` — the newest local
   commit is not necessarily pushed; know where the branch stands.

## Picking a slice

One slice = one module/route/spec, sized to finish in the iteration:

- **Read `api/backend/COVERAGE_NOTES.md` first** to find the next backend
  gap — it's a committed snapshot of per-file coverage so you don't need
  to run `npx vitest run --coverage` (~2-3 min over 258 files) at the
  start of every session. Pick from its ZERO/LOW buckets, favoring real
  logic over scripts/interfaces per its own guidance.
- Prefer untested code with real logic (validators, services, route
  handlers, state transitions) over padding thin wrappers.
- Weigh whether a candidate file is legacy (superseded, dead paths,
  mid-migration code) — lower priority than equally-thin live code, per
  `testing-conventions`' "Legacy code" section. If a slice on legacy
  code turns out too expensive to test honestly, don't force it —
  follow that section's guidance (log it as a known gap, move on).
- For e2e: one spec (or one user flow within a spec) at a time.
- For CI: one job/step change at a time — and remember CI changes can't
  be exercised until the PR to `main` (triggers are main-only), so pair
  them with a local equivalent you *can* run.
- Skim whether another open slice touches the same files before
  starting — cheap insurance against tangled diffs.

## Doing the work

- Follow `testing-conventions` for tier placement, per-iteration
  commands, and the fixed-list runner trap (verify new files actually
  execute).
- **Native verification only.** No `docker compose`, no
  `test:e2e:docker`, no CI during the loop — the Docker gate runs once
  at the end (`ship-to-main`), same end-loaded order that worked for
  helion-v2's rewrite.
- Commit the slice when its targeted tests pass and the relevant full
  native suite is still green.
- **Update `api/backend/COVERAGE_NOTES.md` in the same commit** — move
  the file(s) you just covered out of the ZERO/LOW bucket (or into a
  truer one). Don't let the tracker drift from the code.

## When a test finds a real bug

A new test failing against real product code is the loop working, not a
problem to make disappear:

- If the bug blocks the slice's own acceptance criteria (the thing the
  test exists to prove), fix it inline on the same branch and call it
  out explicitly in the commit message and report.
- If it's unrelated to the slice, don't fix it inline and don't skip
  past it — file it with `gh issue create` and keep going.
- Never resolve the tension by weakening the test.

## When a slice turns out too big mid-iteration

Don't force the full scope through, and don't quietly ship a narrower
slice without saying so. Deliver the load-bearing part that's correct
on its own, commit it, and state plainly in the report what remains and
why — Dennis decides whether the remainder becomes an issue or the next
iteration's slice.

## Ending an iteration

1. Commit; push the branch if the slice is verified
   (`bioavanced-conventions`: pushing the branch is cheap and runs no
   CI; opening a PR is Dennis's call, never yours).
2. **Run `wrap-up` before composing the final summary** — the moment
   you catch yourself drafting "here's what I did" is the trigger, not
   an afterthought.
3. Report: which slice, what tests were added (file paths), what they
   found, coverage movement if measured, what the next slice should be,
   plus whatever `wrap-up` surfaced.

If the loop is driven by `/loop`, each firing is one iteration of the
above; the loop ends when the tracked scope is done — then hand off to
`ship-to-main` for the Docker gate and CI graduation.

## Maintaining this skill

If the loop keeps stumbling on something these steps don't cover,
update this file. Testing-mechanics lessons go in
`testing-conventions`; repo-wide lessons in `bioavanced-conventions`.
