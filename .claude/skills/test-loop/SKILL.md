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

### Issue labels

Labels are how findings get filtered without re-reading every issue's
body. Check them, and set them correctly on anything you file:

- `gh issue list --state open --label test-branch` surfaces findings
  filed from prior test-loop sessions (per the `legacy` skill and any
  other skill that tells you to use this label) — read these each
  session alongside the umbrella issues, since one may already cover
  the gap you're about to pick as a slice.
- When filing a new issue yourself, apply whichever labels actually fit
  from `gh label list` (`bug`, `documentation`, etc.) — don't leave a
  real finding unlabeled by default. Apply `test-branch` specifically
  when the finding follows the `legacy` skill's framing (found during
  test-loop work on the current branch, meant to be revisited once that
  branch's PR merges) — see that skill for the full framing and don't
  apply the label to unrelated findings.
- If you notice a labelless issue that clearly fits an existing label
  (including one filed by a past session), add the label rather than
  leaving it to drift — labels are only useful if they stay accurate.

## Before an iteration

1. If this session resumed from a compact or interruption, check
   whether the previous iteration actually finished — specifically
   whether its `wrap-up` audit ran to completion (confirmed miss
   2026-07-03: an interrupted wrap-up was abandoned after a compact
   and a new slice started instead). A compact is not a clean slate:
   finish the interrupted iteration's close-out first.
2. `git status` — confirm a clean tree and which branch you're on;
   commit or flag any leftovers before starting.
3. `gh issue list --state open` — re-read the tracking issue(s) for
   scope that's already been delivered vs. still open.
4. Check `git log --oneline -5` vs `origin/<branch>` — the newest local
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
  the `legacy` skill. If a slice on legacy code turns out too expensive
  to test honestly, don't force it — follow that skill's guidance (log
  it there as a known gap, move on).
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
- Commit the slice when its own targeted tests pass — don't run the
  full native suite per iteration. The backend suite is in the
  thousands of tests now, so a full run per slice is too slow to pay
  every iteration; targeted-green is enough signal to commit. The full
  native suite runs once, at the coverage-reconcile phase (before the
  Docker gate — see below and `ship-to-main`), which is where
  cross-slice interaction actually gets caught.
  **Confirmed miss 2026-07-03:** ran a bare `npx vitest run
  --reporter=basic` (whole suite, no path) mid-iteration despite this
  rule being in context at the time — the instruction being present
  isn't enough on its own, treat "am I about to run vitest with no
  file path argument" as a question to ask before every `Bash` vitest
  call during a loop iteration, not just a rule to have read.
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
2. **Invoke `wrap-up` via the Skill tool — a fresh call, every
   iteration — and work its audit through to completion before a
   single word of the final summary is drafted.** The push in step 1
   triggers a hook reminder for exactly this. Having the wrap-up text
   in context (from earlier, or from a compact summary) is not an
   invocation, and writing its checklist from memory is not an
   invocation — the Skill call itself is the verifiable step
   (confirmed miss 2026-07-03: several iterations faked the audit as
   remembered prose). This step blocks step 3.
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
