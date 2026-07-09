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
- **If the picked issue bundles multiple sub-points and only some are
  confirmed/fixed this iteration, split the unresolved ones into their
  own new issue before closing the original** (confirmed 2026-07-08,
  issue #77 → #105: #77 covered three related gaps in
  `import.service.js`; only the NaN-temperature one was a confirmed bug
  and got fixed, the "unknown dataType fail-open" point was left as a
  maintainer-decision item and almost got buried in a comment on the
  issue being closed). Closing an issue with an unresolved point
  documented only in its comment thread makes that point undiscoverable
  next session — it needs its own open issue to stay trackable.
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
- **Before treating "missing source file the test requires" as a
  never-committed/abandoned feature, check whether the code used to
  exist and was deliberately removed.** `git log --all --diff-filter=D
  --oneline -- <path>` finds the deleting commit; check its message and
  full diff (`git show --stat <hash>`) for a wider intentional removal
  (confirmed pattern, 2026-07-08, issue #101: `ImportPredictor.js` +
  its controller method + route existed, test-loop wrote tests for
  them, then Denise deleted the whole feature bundle a day later in a
  large merge — the tests were orphaned by an intentional cleanup, not
  a dangling reference to work that was never finished). If a removal
  commit exists and reads as deliberate, don't reimplement the feature
  — delete the orphaned tests instead and close the issue explaining
  it was removed by the project owner, referencing the deleting
  commit. Only fall back to "reimplement" or "ask Dennis" if no such
  removal commit exists.
- **When a canonicalization/rename merge breaks a test file, don't stop
  at the rename — check whether the same commit silently dropped a
  whole function or guard clause, not just relabeled fields.** A
  refactor commit that touches a file end-to-end can lose code that had
  nothing to do with the rename, and it only surfaces as an unrelated
  `TypeError`/missing-behavior once you actually run the suite (confirmed
  2026-07-09, issues #119→#126/#127: fixing `sample.service.test.js`'s
  stale `patientID`/`sampleID` fixture for the `e2549bee`
  canonicalization merge uncovered that the same commit had deleted
  `enforceAppendOnlyCollection`/`guardBulkWrite` from
  `sampleMovementLedger.js` entirely — breaking 3 live call sites, not
  just tests — and separately deleted `withdrawSample`'s terminal-status
  guard, leaving its `invalidStatuses` array declared but unused).
  `git show <hash> -- <file>` on the full diff (not just the hunks you
  expect) is what catches this; grepping only for the renamed field
  will miss it. Each such drop is its own issue and its own fix, even
  when discovered mid-iteration on an unrelated pick — `git show
  <hash>` against the pre-merge version tells you whether it's safe to
  restore verbatim.
- If the issue is ambiguous (can't tell what correct behavior *should*
  be from the code, tests, or issue thread), ask on the issue / ask
  Dennis rather than guessing at intended behavior.
- **Before punting an "ambiguous, needs a design call" sub-point to the
  project owner, trace its actual callers to check whether it's even
  reachable.** A branch that *looks* like it requires a judgment call
  about intended leniency (e.g. "should X be allowed to fail open?")
  can turn out to be dead-guarded — every real caller already prevents
  the condition from occurring, so no existing behavior depends on the
  current leniency and a defensive fail-closed fix is safe and
  unambiguous, no sign-off needed (confirmed 2026-07-08, issue #77 →
  #105: "unknown dataType skips CSV structure validation" first read as
  a design fork, but `import.controller.js`'s `validate` handler
  already whitelists dataType before calling into the branch, and the
  other two callers pass hardcoded literals — so nothing could be
  relying on the fail-open behavior). Grep for all call sites of the
  function/branch in question and check each one's inputs before
  declaring something a genuine design fork like #28's consent
  bypasses (those really do have live callers exercising the bypass,
  which is what makes them a real judgment call). If a memory or prior
  comment already labeled something "needs maintainer input," don't
  take that at face value either — re-trace it yourself before closing
  the loop, the same way you would for a fresh pick.
- The same reachability check can dissolve an entire issue, not just
  one sub-point (confirmed 2026-07-08, issue #106: "mapSampleStatusToFhir
  vocabulary doesn't match Sample.currentStatus enum" was filed as a
  correctness bug with a concrete two-enum mismatch shown side by side —
  looked unambiguous. Tracing the one real caller showed the object
  passed in always carries the *other* status field, already in the
  vocabulary the function expects; no reachable path ever passes the
  mismatched enum. Close as not reproducible against current callers
  rather than "fixing" a mismatch nothing exercises — but if tracing
  turns up a *different* real problem along the way (as it did here:
  the test file asserting the old, removed API), that's still worth its
  own new issue.
- Skim whether another in-flight fix touches the same files — cheap
  insurance against tangled diffs.

### Verifying before deferring — no silent dismissals

This is a recurring failure mode, not a one-off (2026-07-08, issue #77 →
#105 near-miss; 2026-07-09, issues #20/#34/#36 all initially waved off as
"already flagged, needs Dennis" in the first pass of a session — only
re-checked after the user pushed back, and two of the three turned out to
have safe, unambiguous fixes). The pattern: a label or a prior comment
says "needs maintainer input" or "design fork," and that gets treated as
settled fact instead of a claim to verify. **Trust the label only as a
starting hypothesis, never as a finding.**

Before treating *any* issue as blocked-on-Dennis, ambiguous, or
not-worth-fixing — whether it's freshly picked or carries an existing
"needs design call" label from a prior session — do the actual work
first, every time:

1. **Grep every real call site** of the function/branch in question
   (not just the ones mentioned in the issue) and read what each one
   passes in.
2. **Check `docs/` at the repo root** (`docs/architecture/`,
   `docs/inventory/`) for a document that already answers the design
   question — Denise's own architecture contracts and inventory
   snapshots live there and can turn a "needs Dennis's judgment" issue
   into a traceable fact. Confirmed 2026-07-09, issue #111: the issue
   read as "use the payload or remove the call, whichever matches what
   main's rewrite intends" — exactly the kind of call this skill would
   normally punt to Dennis. `docs/architecture/canonical-data-cleanup.md`
   turned out to state the intent directly ("No duplicate operational
   FHIR collections; FHIR is an interoperability boundary"), which
   combined with `fhir-sync.service.js`'s own code (all
   `*FromLegacy`/`*FhirFirst` methods are stubs returning the built
   payload or `null`, with a comment saying no secondary FHIR
   collection is written) settled it without needing to ask. Don't
   skip this check only because a design-call label already exists —
   the label may predate the doc, or predate you finding it.
3. **Write and run the reproduction** — even a quick one — before
   concluding the ambiguity is real. If you can construct a case where
   the "design fork" actually can't be reached, or where a defensive
   fix is safe regardless of which fork Dennis would pick, that's a
   real fix, not a design call.
4. Only *after* steps 1–3 actually ran (not "I recall this was already
   checked") may you conclude an issue is genuinely blocked.

**If, after doing that, it's still genuinely blocked:** post (or
re-post) a `gh issue comment` explaining specifically what you traced
and ran this time, and why it's still ambiguous — even if a near-
identical comment already exists on the issue from a prior session.
A fresh comment each time an issue is touched is the audit trail that
proves the check happened rather than being assumed from memory. Do not
present an issue to the user as "blocked, needs your call" in chat
without having posted that comment on the issue itself first.

**Never present a batch of issues to the user as "nothing fixable this
iteration" based on reading titles/labels/past comments alone.** Do the
trace-and-repro pass on each candidate first. If that pass turns up
zero fixable issues, say so and show the trace you did for each one —
not just "these were already flagged."

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

Also: a user "go ahead" authorizes only the specific blocked action named
in the classifier's denial reason at that moment (e.g. the merge) — it
does not carry forward to the *other* blocked steps in the same ending
sequence (issue comment, remote branch deletion), even if they were all
described together beforehand. Each will re-block and needs its own
explicit go, one at a time, as it's attempted (observed 2026-07-07: "Go
ahead" cleared the merge but the very next issue-comment attempt and the
branch-deletion attempt both re-blocked). Don't assume a blanket
authorization; ask again per action if the classifier denies it.

Also: a permission denial's stated reason can be stale — attached to an
earlier attempted action in the same session rather than the command
actually being blocked (observed 2026-07-08: a blocked `git reset --hard`
used only to force a `--no-ff` merge bubble after a same-content
fast-forward had already landed; the *next*, unrelated command — deleting
the now-merged fix branch on the remote — was denied citing that same
reset as its reason, even though the reset itself never ran). Don't
assume the cited reason accurately describes the current command; if the
action is otherwise safe and expected by this workflow (e.g. remote
branch cleanup after a confirmed merge), surface it and ask for a fresh
go-ahead rather than treating the stale reasoning as a real objection to
investigate.

Also: don't chain the plain integration-branch push together with the
fix-branch deletion in one Bash call — a denial on the deletion half
blocks the whole compound command, so the push doesn't happen either
even though it alone would have been fine (observed 2026-07-07). Push
the integration branch by itself first, confirm it landed, then do the
branch deletion (local + remote) as its own call.

Same problem the other direction: don't chain `git checkout
feature/docker-e2e-backend-integration && git pull && git merge
--no-ff ...` in one call either — a denial on the merge half blocks the
whole command, and the `checkout` does not stick (you're left back on
the fix branch, not on the integration branch as the partial command
might suggest), so it has to be redone from scratch as a separate call
(observed 2026-07-07). Do the checkout+pull as their own call, confirm
with `git branch -vv`, then run the merge as its own call.

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
