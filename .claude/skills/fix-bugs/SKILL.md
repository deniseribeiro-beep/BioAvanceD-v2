---
name: fix-bugs
description: Per-iteration workflow for fixing bugs tracked as GitHub issues in BioAvanceD-v2 — pick one issue, reproduce it with a failing test, fix the product code, un-weaken any tests that were pinned to the buggy behavior, verify natively, commit, wrap up. The counterpart to test-loop (which never touches product code). Use when asked to "fix bugs", "work the bug backlog", "fix issue #N", or when driven by /loop on bug-fixing.
---

# Bug-fixing loop — one iteration

The test-building push (`test-loop`) files bugs as GitHub issues and
deliberately never fixes them. This skill is the other half: work
through those issues, one bug per iteration. Read
`bioavanced-conventions` and `testing-conventions` first — this skill
covers the loop mechanics, not the conventions they already answer.
Unlike `test-loop`, editing product source (`api/backend/src`,
`frontend/src`) is the *point* here — but only the code the picked
issue actually requires.

## Where the work is tracked

- GitHub Issues on `deniseribeiro-beep/BioAvanceD-v2` are the tracker.
  `gh issue list --state open --label bug` is the backlog;
  `--label test-branch` surfaces findings filed from test-loop sessions
  (see the `legacy` skill for that label's framing). Check fresh each
  session — don't trust memory of a prior session's state.
- **File new findings with `gh issue create` freely** (blanket OK,
  2026-07-02). If fixing one bug uncovers another, file it and stay on
  the picked issue — don't chain fixes in one iteration.
- Comment on the issue when the fix is committed (commit hash, one-line
  summary, `Fixes #N` in the commit message). Once the fix is merged
  into `feature/docker-e2e-backend-integration` and verified there,
  **close the issue by hand** with `gh issue close <N> --comment "..."`
  (confirmed workflow, 2026-07-07 — closing on merge into the
  integration branch is fine; this is separate from opening a PR to
  `main`, which stays Dennis's call, never yours).

## Before an iteration

1. If this session resumed from a compact or interruption, check
   whether the previous iteration's `wrap-up` audit ran to completion —
   a compact is not a clean slate (incident
   `wrapup-abandoned-post-compact`,
   `bioavanced-conventions/references/incidents.md`).
2. `git status` — clean tree, right branch; commit or flag leftovers
   before starting.
3. `gh issue list --state open --label bug` (plus `test-branch`) —
   re-read the backlog; note issues already commented as fixed-awaiting-
   merge so you don't re-pick them.
4. Check `git log --oneline -5` vs `origin/<branch>` — know where the
   branch stands.

## Picking a bug

One iteration = one issue, sized to finish in the iteration:

- Prefer issues with a clear reproduction and a test already asserting
  the buggy behavior (test-loop leaves a code comment naming the issue
  number above such assertions — `grep` the test tree for `#N` to find
  them). Those come with a built-in verification harness.
- Prefer user-facing correctness bugs over cosmetic/logging ones.
- Weigh whether the buggy code is legacy per the `legacy` skill — a bug
  in a dead or superseded path may not be worth fixing; say so on the
  issue instead of fixing it, and let Dennis decide.
- If the issue is ambiguous (can't tell what correct behavior *should*
  be from the code, tests, or issue thread), ask on the issue / ask
  Dennis rather than guessing at intended behavior.
- Skim whether another in-flight fix touches the same files — cheap
  insurance against tangled diffs.

## Branch

Follow `bioavanced-conventions` git hygiene: branch before the first
Edit/Write. Use `fix/<slug>` (e.g. `fix/patient-service-null-dob`) off
the branch the bug lives on — usually the active feature branch if the
bug was found there. **`main` is currently frozen** (see
`bioavanced-conventions`) — do not base a fix branch off `main`'s tip;
use `feature/docker-e2e-backend-integration` instead unless the bug's
test lives on a different branch. Ask Dennis if unsure which base he
wants; never work on `main` directly. Small related fixes may share one
`fix/` branch as separate commits, but don't mix unrelated subsystems.

## Doing the fix — reproduce first

1. **Reproduce before touching product code.** Write (or locate) a
   failing test that captures the *correct* expected behavior and fails
   against current code. If test-loop already pinned the bug, flip that
   assertion to the correct expectation now — it should fail. No
   reproduction, no fix: if you can't make it fail, reopen the question
   on the issue instead of "fixing" blind.
2. Fix the product code — the minimal change that makes the correct
   expectation pass. No drive-by refactors, no lazy fixes
   (`bioavanced-conventions`: no skip-flags, no env-var band-aids —
   fix the root cause the next developer would otherwise hit).
3. **Un-weaken every test pinned to this bug.** Search the test tree
   for the issue number; each assertion that encoded the buggy output
   gets updated to the correct behavior and its bug comment removed.
   Leaving one behind means a spurious failure or, worse, a green test
   endorsing behavior that no longer exists.
4. Run the targeted tests for the touched files, plus the suites of
   the module(s) you changed — a bug fix changes product behavior, so
   cast a slightly wider net than test-loop's per-slice runs. Still
   **native verification only** — no Docker, no CI mid-loop; the gate
   order stays end-loaded (`ship-to-main`). And still never bare
   `vitest` with no file path (incident `bare-vitest-mid-loop`).
5. If the fixed file appears in `api/backend/COVERAGE_NOTES.md`
   buckets and the fix's new tests moved its coverage, update the
   bucket in the same commit; narrative goes to `COVERAGE_HISTORY.md`.

## When a fix turns out too big mid-iteration

Same rule as `test-loop`: don't force it, don't quietly ship a partial
fix as if complete. If a safe subset stands on its own, commit that and
state plainly on the issue and in the report what remains; otherwise
revert to a clean tree, write up what you learned on the issue, and let
Dennis decide the next step.

## Ending an iteration

Note: even though this whole sequence is the confirmed workflow, the
auto-mode permission classifier evaluates each action independently and
has blocked the issue comment/close, the merge into
`feature/docker-e2e-backend-integration`, and the branch deletion on a
per-call basis (observed 2026-07-07) — "documented in this skill" isn't
sufficient context for it. Don't try to route around a block; surface it
and get an explicit go-ahead for that step, then continue.

Also: don't chain the plain integration-branch push together with the
fix-branch deletion in one Bash call — a denial on the deletion half
blocks the whole compound command, so the push doesn't happen either
even though it alone would have been fine (observed 2026-07-07). Push
the integration branch by itself first, confirm it landed, then do the
branch deletion (local + remote) as its own call.

1. Commit with `Fixes #N` (or `Refs #N` for partial work); push the
   `fix/<slug>` branch once verified. Comment the commit hash on the
   issue.
2. **Merge the fix branch into `feature/docker-e2e-backend-integration`**
   (confirmed workflow, 2026-07-07, while `main` stays frozen — see
   `bioavanced-conventions`): `git checkout feature/docker-e2e-backend-integration`,
   `git pull`, `git merge --no-ff fix/<slug> -m "..."`, re-run the
   targeted tests against the merged tree, then
   `git push origin feature/docker-e2e-backend-integration`. Then delete
   the fix branch, local and remote (`git branch -d fix/<slug>` +
   `git push origin --delete fix/<slug>`) — it's fully absorbed into the
   integration branch at that point. This is distinct from opening a PR
   to `main`, which stays Dennis's call, never yours.
3. **Close the issue** with `gh issue close <N> --comment "..."` noting
   the merge commit hash — don't just comment that it's fixed and leave
   it open (confirmed workflow, 2026-07-07).
4. **Invoke `wrap-up` via the Skill tool — a fresh call, every
   iteration — and finish its audit before drafting the summary**
   (incident `wrapup-faked-from-memory`). This blocks step 5.
5. Report: which issue, root cause in a sentence, what changed (file
   paths), which tests prove it (including un-weakened ones), what the
   next bug pick should be, plus whatever `wrap-up` surfaced.

If driven by `/loop`, each firing is one iteration; the loop ends when
the backlog is worked or Dennis stops it — then `ship-to-main` for the
Docker gate and the PR conversation.

## Maintaining this skill

If the loop keeps stumbling on something these steps don't cover,
update this file. Testing-mechanics lessons go in
`testing-conventions`; repo-wide lessons in `bioavanced-conventions`;
incident narratives in `bioavanced-conventions/references/incidents.md`.
