# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`,
after Dennis picked up two backlog items ("Pick #553 & #518" — #518 turned
out already closed/merged, corrected to #558 mid-conversation).

## What happened this session

Ran `work-issue` to classify both picks, then routed each to its matching
workflow skill and resolved both in full, one iteration apiece with its
own `wrap-up` audit.

- **#553** (`resolve-issue`, doc-accuracy/board-hygiene route) — Fixed the
  "14 Fase 2 sources" miscount to 16 (Plano Integrado §7.4 steps 2-8 sum
  to 16, not 14). Corrected all 11 `reference-data-bootstrap-*` comments
  in `compose.dev.yml`, plus the related "remaining 13 Fase 2 sources"
  phrasing (13 = 14 - 1 HPO) to "remaining 15" in
  `docs/architecture/reference-data-seeding.md` and the `hpo.js`/
  `pipeline.js` docstrings. Doc-only, no functional impact. Branch
  `test/553-fase2-source-count-fix`, commit `d624d9f1`, merged `c01bd3d5`.
- **#558** (`fix-bugs`, stale-test direction — route 2) — Un-weakened the
  2 pinned assertions in `api/backend/tests/unit/storageService.test.js`
  (`allocateSampleToPosition`/`autoAssignSampleToBox` happy paths) that
  still expected `$set['status'] === 'AVAILABLE'`, stale since #544
  (`c1b9ad03`) removed that write from `MongoStorageRepository` (which
  `storageService.js` delegates to entirely). Reproduced first (both
  failed with "expected undefined to be 'AVAILABLE'"), then fixed to
  `toBeUndefined()` with the same explanatory comment #544's own fix
  already used in `MongoStorageRepository.test.js`. Test-only — no
  product code touched. 63/63 green in `storageService.test.js`, both
  pre- and post-merge. Branch
  `fix/558-storageservice-stale-status-assertions`, commit `ae969030`,
  merged `daa17123`.

Neither iteration touched product source beyond the one test file #558
needed (#553 was docs/comments only). Both branches deleted locally after
merge (no remote branches were ever pushed for either — merged straight
into the integration branch before the first push of that branch).

### Closed this session

- **#553** and **#558**, both closed with resolution comments naming the
  merge commit hash.

### Filed this session

None — no new findings surfaced during either fix.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `daa17123`, clean,
  pushed, up to date with origin. Carries #553's doc-count fix and #558's
  test un-weakening on top of everything the prior handoff described
  (the full RF028 Fase 2 live-verify cluster, closed last session).
- Docker: not used this session — both fixes were doc/test-only, no
  Mongo/Docker-dependent code touched.
- **Pre-existing dangling local branches, not touched this session**
  (carried forward unchanged — `fix/476-...`, `fix/477-...`,
  `fix/481-...`, `fix/485-...`, `fix/513-...`, `test/377-...`,
  `test/428-...`, `test/431-...`, `test/440-...`, `test/441-...`,
  `test/486-...`, `test/507-...` through `test/511-...`, the nine
  `test/549-*-reference-source` branches, plus a stray
  `worktree-agent-*` branch — not re-verified against the integration
  branch this session either; see earlier handoffs or run the
  `resolve-issue` dangling-branch sweep before trusting this list).

## Which issue is next

Dennis has not said what's next this session — per this skill's own
rule, **none queued**.

Candidates carried forward from the prior handoff (both this session's
picks, #553 and #558, are now resolved and removed from the list):

- **#551** — full AC7 lifecycle (checkpoint/resume, quarantine recovery,
  rollback). Unchanged, still open.
- **#552** — Neo4j outbox projection (AC9) for TerminologyConcept/
  TerminologyRelation. Unchanged, still open.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`.
  Unrelated to the RF028 cluster, still open.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed this session.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it?
- Older backlog, unchanged: `#371`/`#374`/`#378`/`#379`, `#368`, `#345`,
  `#341`/`#340`, `#334`, `#331`/`#326`/`#325`, `#321`, `#319`, `#286`,
  `#284`, `#283`, `#282`, `#228`, `#115`, next e2e slice per
  `E2E_TRACEABILITY_PLAN.md`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263/#265/#267/#268/#269/#270/#271**
  — pack-repo only, low priority, unchanged this session. (#266 is
  resolved by #267; #267/#268/#269/#270/#271 are the pack maintainer's
  call, not this repo's.)

## Dev stack state

Not brought up this session — no Docker/database-dependent code touched.
Same state as the prior handoff left it: torn down, named volumes
(mongodb/neo4j data) untouched, images cached.

## Which skills to use

- **`work-issue` → `resolve-issue`/`fix-bugs` routing worked cleanly for
  both picks this session** — no misroute, no skill-text friction to
  report from either `wrap-up` audit. #553 was the route-6 default
  (board-hygiene, doc-only); #558 was route 2 (stale test broken by an
  owner's own intentional prior change, confirmed via `git log --grep`
  against the exact commit the issue named before touching anything).
- **When un-weakening a pinned assertion that has an exact sibling
  precedent from an earlier related fix** (here: #544's own
  `MongoStorageRepository.test.js` edit, same repo, same day-ish,
  same root cause cascading to a second file), pull the precedent
  commit's diff (`git show <hash> -- <file>`) and match its comment
  wording/assertion style exactly rather than inventing new phrasing —
  keeps the two sibling fixes reading as one consistent decision instead
  of two independently-worded ones.
- Nothing else new to report — see prior handoffs for the accumulated
  repo-wide lessons (`.claude/skills/build-loop/local-env/` junctions,
  `test-loop`'s full-suite-guard hook inconsistency, etc.), all still
  believed current.
