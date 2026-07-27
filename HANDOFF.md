# HANDOFF

**Written:** 2026-07-27, end of a `work-issue` → `resolve-issue` session.
**Branch:** `feature/docker-e2e-backend-integration` (commit `f2ab269b`,
pushed, working tree clean apart from a pre-existing untracked
`docs/DENISE_VALIDATION_STATUS.md` from before this session, left alone).

## What happened this session

Prior handoff (auth.controller.js #266 session) flagged #277 and #275 as
the natural next pick — same coverage-tooling-nondeterminism shape,
unassigned, not blocked on Denise. User explicitly asked to actually try
to resolve an issue this time rather than assume it can't be done, so
this session went past the "re-verify and document" pattern used for
the last three sessions (#274, #258, #266) and root-caused it:

- Reproduced the #275/#277 drift directly: ran the same 9-file
  `patient.service.js` `--coverage.include` combo 5x back-to-back with
  no code changes — confirmed it's **bimodal**, not random (flips
  between exactly two outcomes: 391/462 vs 399/462 stmts, 279/401 vs
  311/401 branches).
- Tried `node --no-flush-bytecode` (V8 GC-bytecode-flush theory) —
  ruled out, same bimodal split persisted across 5 runs.
- Tried `--no-isolate` — this *does* eliminate the drift (stable across
  4 runs), but breaks
  `patient.service.encryption-clinicalunit.gaps.unit.test.js`
  (`expected "vi.fn()" to be called 4 times, but got 0 times`) because
  it removes per-file module isolation that test depends on. Confirmed
  not viable as a repo-wide fix.
- Concluded: this is `@vitest/coverage-v8`'s cross-process coverage
  merge disagreeing with itself between runs, under this repo's
  required `pool: forks` + `isolate: true` config — a real tool
  limitation, not a regression, not fixable from this repo without
  sacrificing test isolation.
- Documented as a third distinct phantom-coverage pattern (alongside
  guard-clause-implicit-else and try/await) in
  `api/backend/COVERAGE_NOTES.md`, commit `f2ab269b`.
- Commented the full findings on both #277 and #275 (cross-referencing
  each other and #242) and closed both.

## Repo state

- `feature/docker-e2e-backend-integration`, at `f2ab269b`, working tree
  clean, pushed.
- No fix/feature branches created — docs-only change, committed
  straight to the integration branch (same pattern as #274/#258/#266
  sessions).

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Last full
reconcile (2026-07-24, session 16, pre-session commit `a636b37a`):
Statements 94.01%, Branches 88.2%, Functions 92.33%, Lines 94.29%. This
session made no coverage-numerator change (documented/closed two
existing tooling-nondeterminism gaps) — no full-suite reconcile run,
top-line numbers unchanged/unmeasured.

## Recommended next steps

Remaining open backlog: #228, #224, #222, #115 — all design-call-blocked
and assigned to Denise. This is now the **sixth** consecutive session
flagging that this subset can't move without Dennis's input — the
backlog of *unblocked* work is now exhausted (both coverage-tooling
nondeterminism issues, #277/#275, are closed alongside #266 from last
session). Worth raising directly with Dennis rather than continuing to
flag it: either get a design call on #228/#224/#222/#115, or the next
session needs a fresh source of unblocked work (new coverage gap sweep,
new backlog items, etc.) since nothing else is currently open.

## Which skills to use

`work-issue` to pick/route. `dyeallpies-skills-pack#125` (filed several
sessions ago, still open per last handoff) covers the "verify and close
a filed coverage-gap finding with no code change" shape — this session
extended that pattern to a genuine root-cause investigation rather than
just re-confirmation, worth folding that nuance into whichever skill
`#125` lands as.

## Dependency notes

None blocking. `dyeallpies-skills-pack#124`/`#122`/`#123`/`#125`/`#126`
are pack-repo items, not BioAvanceD-v2 blockers.

## Session note

No scope creep — docs-only change, both candidate fixes tried were
cleanly ruled out/confirmed with actual repeated-run evidence rather
than assumed. No lazy fixes, no security-relevant surface touched. The
unblocked backlog is now empty; the design-call-blocked subset (#228,
#224, #222, #115) needs Dennis's input before further sessions have
anything to pick up.
