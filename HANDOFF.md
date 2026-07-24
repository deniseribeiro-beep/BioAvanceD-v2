# HANDOFF

**Written:** 2026-07-24, end of a fix-bugs iteration.
**Branch:** `feature/docker-e2e-backend-integration` (commit `462410d1`,
pushed).

## What happened this session

Read `HANDOFF.md`, then ran `work-issue`, which routed to `fix-bugs` for
issue #250 (`MongoAuditRepository.js`'s `appendImmutableAudit()` called
`this.db.collection('sample_movements')` with a hardcoded literal
instead of resolving the name via `CANONICAL_COLLECTIONS`/
`collectionResolver` like the rest of the codebase — latent risk: if
`COLL_SAMPLE_MOVEMENTS` were ever set, audit writes would silently split
from every other consumer of the sampleMovements collection).

Considered #254 too (dead-code post-validate re-checks in
`sample.service.js`) but routed it as owner's-call dead code, not a
reproducible defect — left open, untouched.

Reproduced first: added a new describe block to
`tests/unit/MongoAuditRepository.test.js` overriding `CANONICAL_COLLECTIONS`
via direct `require.cache` exports replacement (vi.mock/doMock/dynamic
import all failed to intercept `require()` here — same documented CJS
gotcha), confirmed it failed against the unfixed code (either erroring
because `config/collections` wasn't yet in `require.cache`, or resolving
the wrong name). Fixed `src/infrastructure/persistence/mongo/MongoAuditRepository.js`
to import `CANONICAL_COLLECTIONS` and use `CANONICAL_COLLECTIONS.sampleMovements`
instead of the literal, for both the `db.collection(...)` call and the
`enforceAppendOnlyCollection` name arg. Ran the full
`MongoAuditRepository.test.js` + `.proxy.unit.test.js` suites (9/9
passing), plus `sample.service.test.js` + `storageService.test.js`
(155/155 passing total) — no regressions.

Committed on `fix/mongo-audit-repository-canonical-collection` (`bc27dd28`,
`Fixes #250`), pushed, commented the hash on the issue, merged `--no-ff`
into `feature/docker-e2e-backend-integration` (`462410d1`), re-ran the
targeted tests on the merged tree, pushed, deleted the fix branch (local
+ remote), closed #250 with the merge commit hash.

Filed a skills-pack issue (`dyeallpies-skills-pack#115`) instead of
editing the installed `cjs-mocking.md` skill file directly (junction —
Rule 0): documents that the existing "require.cache injection for a
whole dependency module" pattern also works for a frozen plain
data-object config export (not just classes-by-reference), with the
exact section text to add.

## Repo state

- `feature/docker-e2e-backend-integration` current and pushed
  (`462410d1`) — includes this session's #250 fix, merged from
  `fix/mongo-audit-repository-canonical-collection` (branch deleted
  after merge).
- Working tree clean.

## Milestone (set 2026-07-22 by Dennis, still current)

**Target: 90% across all four coverage dimensions.** Last full reconcile
was 2026-07-23 morning (`f3c258c9`): Statements 91.54%, Branches
**83.37%** (lagging dimension), Functions 90.96%, Lines 91.98%. Several
sessions' worth of slices since then aren't folded into that number yet
— a fresh full reconcile is still overdue (unchanged from last session's
note; this session touched product code, not coverage).

## Recommended next steps

Per prior sessions' notes, do a full coverage reconcile before picking
the next Phase 2 test-loop slice.

Remaining open backlog beyond this (not re-checked further this
session): #254, #251, #224, #222, #115, #255-#267 — see `gh issue list
--state open`. #254 and #251 are dead-code/owner's-call items (post-
validate re-checks and DB-lookup-miss branches respectively), not
reproducible bugs — `fix-bugs` isn't the right route for them without a
fresh reachability trace; #255-267 are similar dead-code/gap findings
from prior test-loop sessions, owner's call whether to remove/wire in.
#250 (this session) and #252/#253 (prior two sessions) are now closed.

## Which skills to use

`work-issue` to route the next pick. `fix-bugs` if a reachability trace
on one of the remaining dead-code issues (#254, #251, #255-267) turns up
a live caller after all. `test-loop` for the next coverage slice once a
fresh reconcile identifies one. `bioavanced-v2-conventions` and
`bioavanced-v2-testing-conventions` as always — the latter's
`cjs-mocking.md` will gain a new section once `dyeallpies-skills-pack#115`
is applied. `wrap-up` every iteration.

## Dependency notes

None blocking. A full coverage reconcile is recommended (not required)
before the next test-loop slice. `dyeallpies-skills-pack#115` is a
pack-repo issue, not a BioAvanceD-v2 blocker.

## Session note

New pattern this session: `require.cache` exports overwrite (not
`vi.mock`/`vi.doMock`/dynamic `import` + `resetModules`) is what actually
works for asserting a source reads a frozen config data-object at
call-time rather than a hardcoded literal. Filed as
`dyeallpies-skills-pack#115` for the shared skill file rather than
editing the installed junction directly.
