# HANDOFF

**Written:** 2026-07-27, end of a `work-issue` session.
**Branch:** `feature/docker-e2e-backend-integration` (commit `bf4f6136`,
pushed, working tree clean).

## What happened this session

Read the prior handoff (NotificationService.js #258 session), which
flagged backlog scarcity for a fourth consecutive session — all 7
remaining open issues (#277, #275, #266, #228, #224, #222, #115) were
either design-call-blocked and assigned to Denise (#224, #222, #115,
#228 — require asking Dennis first per repo conventions) or unassigned
coverage-tooling nondeterminism findings (#277, #275, #266).

Picked #266 (`@vitest/coverage-v8` undercounts statements/branches
inside `try` blocks containing `await`s, in `auth.controller.js`) since
it wasn't blocked on Denise and had a concrete, checkable claim.

- Re-verified against current source: line 122 (catch-block
  `logger.error`) and the false arm of the `if (!oldMatches)` branch at
  line 325 both still show 0 hits in `coverage-final.json` despite
  passing tests directly asserting their side effects — confirmed via
  `statementMap`/`branchMap` inspection, not just the summary table.
- Investigated a candidate root cause: `npm ls` flagged the installed
  `vitest@4.1.9` / `@vitest/coverage-v8@4.1.10` pair as invalid
  (version mismatch). Realigned `vitest` to `4.1.10` and reran coverage
  — same 0-hit result, so the mismatch wasn't the cause. Reverted the
  dependency change (`git checkout -- package.json package-lock.json`)
  before committing, to keep the commit scoped to documentation.
- Documented this as a second, distinct phantom-coverage pattern in
  `api/backend/COVERAGE_NOTES.md` (alongside the already-documented
  guard-clause-implicit-else pattern), commit `bf4f6136`. No product or
  test code changed.
- Commented the finding (including the ruled-out version-mismatch
  theory) on #266 and closed it.

## Repo state

- `feature/docker-e2e-backend-integration`, at `bf4f6136`, working tree
  clean, pushed.
- No fix/feature branches created this session (docs-only change,
  committed straight to the integration branch, same pattern as the
  #274 and #258 sessions).

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Last full
reconcile (2026-07-24, session 16, pre-session commit `a636b37a`):
Statements 94.01%, Branches 88.2%, Functions 92.33%, Lines 94.29%. This
session made no coverage-numerator change (documented an existing gap
as permanently accepted) — no full-suite reconcile run, top-line
numbers unchanged/unmeasured.

## Recommended next steps

Remaining open backlog after this session: #277, #275, #228, #224,
#222, #115 — down one (#266 closed). #277 and #275 are the same
coverage-tooling-nondeterminism shape as #266 (unassigned, not blocked
on Denise) and are the natural next pick if continuing this pattern.
#228/#224/#222/#115 remain design-call-blocked and assigned to Denise —
this is now the **fifth** consecutive session flagging that the
design-call subset can't move without Dennis's input; worth raising
directly rather than repeating the flag a sixth time.

## Which skills to use

`work-issue` to pick/route. `dyeallpies-skills-pack#125` (filed two
sessions ago, still open per last handoff) covers the "verify and close
a filed coverage-gap finding with no code change" shape used for #274,
#258, and now #266 — three sessions in a row have needed this
workaround; worth prioritizing the merge.

## Dependency notes

None blocking. `dyeallpies-skills-pack#124`/`#122`/`#123`/`#125`/`#126`
are pack-repo items, not BioAvanceD-v2 blockers.

## Session note

Straightforward re-verification + close, no scope creep (a candidate
dependency fix was tried, ruled out, and cleanly reverted before
committing), no lazy fixes, no security-relevant surface touched.
Design-call backlog subset flagged for a fifth consecutive session —
see "Recommended next steps" above.
