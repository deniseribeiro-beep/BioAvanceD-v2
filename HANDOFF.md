# HANDOFF

**Written:** 2026-07-27, end of a `work-issue` -> `fix-bugs` iteration.
**Branch:** `feature/docker-e2e-backend-integration` (commit `fec6b0e9`,
pushed, working tree clean).

## What happened this session

Dennis asked to read the prior handoff and resolve an issue. Routed to
**#271** (`orphanet.js`: remaining branch gaps left unverified by a prior
test-loop session).

- Read the full issue body (5 listed candidate branches) and traced each
  one against real call sites, per `fix-bugs`' verifying-before-deferring
  section:
  - `dedupeRecords` merge (`previous.synonyms || []` / `aliases || []`,
    lines 159-160): **dead**. Every value stored in the map comes from
    `normalizeDiseaseRecord`, which always sets `synonyms`/`aliases` to
    an array — traced all 3 call sites of `normalizeDiseaseRecord` plus
    `dedupeRecords` itself.
  - `searchLocal`'s `numericOrpha ? [...] : []` ternaries (cids filter
    and orphanet filter): **dead**. `getOrphaNumeric(search)` is
    non-empty for any non-empty input, and every real call site passes a
    non-empty `q` (the route 400s on empty query before `searchLocal`
    runs).
  - `pickReference`'s final `''` fallback, and the
    `fetchJsonWithTimeout`/`extractOrphadataResults`/`searchRemote`/
    route-catch branches: **real, reachable gaps** (untrusted
    external/Mongo data shape, fetch-response variance) — not dead code,
    need test-writing not a product fix.
  - Ran isolated coverage twice on the same file/test combo and got
    different branch-hit numbers both times — matches the documented
    coverage-tooling nondeterminism (#277/#275's pattern), not a new
    finding; traced by call-site logic instead of trusting the numbers.
- Branched `fix/orphanet-dead-branches` off the integration branch,
  simplified the two dead-code spots (kept exact same runtime behavior),
  ran `tests/unit/orphanet.routes.test.js` +
  `tests/unit/routes/orphanet.test.js` + `tests/unit/routes/orphanet-count.test.js`
  (44/44 pass) and `npm run lint` (clean). Committed (`Refs #271`,
  `0a7e0fd8`), pushed, merged `--no-ff` into
  `feature/docker-e2e-backend-integration` (`fec6b0e9`), re-ran the same
  44 tests on the merged tree (still pass), pushed, deleted the fix
  branch (local+remote).
- Filed **#278** for the real gaps split out of #271 (pickReference
  fallback, fetch/async branches) — test-loop work, not fix-bugs.
- Commented the trace and split on #271, closed it referencing `0a7e0fd8`
  / `fec6b0e9`.
- `wrap-up` core + shipping audits ran clean — no scope creep (only
  `orphanet.js` touched, plus the new issue filing), no lazy fixes,
  nothing deferred without a tracked issue (the real gaps landed in
  #278), nothing security-relevant.

## Repo state

- `feature/docker-e2e-backend-integration`, pushed at `fec6b0e9`,
  working tree clean.

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Last full reconcile
(2026-07-24, session 16, pre-session commit `a636b37a`): Statements
94.01%, Branches 88.2%, Functions 92.33%, Lines 94.29%. Unaffected this
session (dead-branch simplification, no coverage-relevant behavior
change — the branches were already unreachable).

## Recommended next steps

Dennis asked to keep working the issue backlog (implied by "resolve
issue" pattern across recent sessions) — no specific issue named for
next round, so **none queued**; re-scan fresh via `work-issue` next
session. Open backlog as of this session's scan (`gh issue list --state
open`, largest-numbered first, before this session's #278 filing):
#278 (new — real orphanet.js gaps, routes to test-loop), #277, #275
(coverage-tooling nondeterminism, different shape — won't route to
`fix-bugs` the same way), #274 (genuine untestable-branch case, needs
malformed-CSV research, not a call-site trace), #270, #269, #267, #266,
#265, #264, #263, #262, #261, #258, #257, #256, #254, #251, #228, #224,
#222, #115. Re-verify state, don't trust this list — several may resolve
the same way #255, #260, #272, #273, and #271's dead half did (dead per
call-site tracing, not actually ambiguous) once traced.

## Which skills to use

`work-issue` to pick/route, `fix-bugs` for the dead-code owner's-call
issues (verifying-before-deferring section is exactly on point — trace
every real call site before treating "needs owner's call" as settled).
`merge-from-main` first if main has moved since last checked (`git fetch
origin && git log --oneline <branch>..origin/main` was 0 this session).
`wrap-up` every iteration.

## Dependency notes

None blocking. `dyeallpies-skills-pack#124` (fold docs+main investigation
into the owner's-call dead-code flow) and `#122`/`#123` are pack-repo
process issues, not BioAvanceD-v2 blockers — not touched this session.

## Session note

No new session note this time — the `daily-merkle.job.js` note from an
earlier handoff (re-check `scheduleNextRun`'s outer catch if `runOnce`'s
error handling is ever touched) still stands and isn't repeated here to
avoid an accumulating log; see that file's own git history if needed.
