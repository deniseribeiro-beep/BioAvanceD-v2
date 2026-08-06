# HANDOFF

**Written:** 2026-08-06, end of session on `feature/docker-e2e-backend-integration`,
after picking up #450 and splitting it into a plan of follow-up issues.

## What happened this session

Dennis said "Pick #450." Routed via `work-issue` -> `resolve-issue`
(refactor/migration item — the five clean-architecture use-cases already
existed, so not a build-loop shape either).

**#450** ("migrate Sample.js locationId/location/storageLocation onto
MongoStorageRepository") asked, as its own first step, for an audit of
which consumers already resolve through the repository vs. still read
Sample's embedded fields directly. Delegated that audit to an `Explore`
agent (read-only, foreground, per `agent-delegation` — the mandatory
pre-check skill had to be invoked first; the guard hook blocked the
first attempt since it hadn't been loaded yet this session).

**Finding: the core is already done, the periphery isn't.** All five
use-cases (MoveSampleUseCase, AllocateSampleUseCase,
GetSampleStorageLocationUseCase, SearchAllocatableSamplesUseCase,
ReleaseSampleUseCase) resolve exclusively through
MongoStorageRepository/MongoStorageTopologyReadRepository — confirmed,
none of them touch Sample's embedded fields. What remains is ~10 backend
files and ~5 frontend files still reading/writing `storageLocation`/
`location`/`locationId` directly, with `storageService.js` flagged as
the single biggest remaining chunk (a large, parallel unconverted
implementation of the repository's box/position logic).

Per `divide-and-conquer`'s design-split playbook, proposed a 6-piece
breakdown to Dennis via `AskUserQuestion`; he chose "file the split, then
implement slice 1 this session."

**Landed (tracker only, plus one blocked attempt):**
- Filed **#473** (storageService.js migration, foundational), **#474**
  (sample.service.js + intakeWizard.routes.js create-path writes, depends
  on #473), **#475** (label.routes.js resolveStorageLocation helper,
  independent), **#476** (equipment-sensor-quarantine.service.js — an
  owner design call: is quarantine state storage-position or separate
  from Sample.location? left genuinely open, not resolved), **#477**
  (import.service.js/import-lgpd.service.js bulk-import writes, depends
  on #473, also flags a possible `locationID`/`locationId` field-name
  mismatch in import.service.js worth checking), **#478** (frontend
  consumers: SampleLocator.tsx, SamplesPageView.tsx, SampleDetailsPage.tsx,
  types/models.ts; depends on #473/#474; also carries two not-yet-audited
  files, FacilityManagementPage.tsx and ClinicalIntakeWizard.jsx, as
  in-scope follow-up rather than leaving them dangling).
- Commented on **#450** recording the split and the five issue numbers.
  Left **#450 open** as the tracking issue, per the playbook.
- **Attempted #473** (`fix/473-storageservice-migrate-to-repository`
  branch, created then deleted — no commits): reading
  `storageService.js` closely showed `allocateSampleToPosition` and
  `releaseSampleFromPosition` were already delegating to
  `MongoStorageRepository` (the original audit's read on those two was
  slightly off). The real gap is `autoAssignSampleToBox` — used in
  production by `intakeWizard.js:392` and
  `auto-assign-sample.controller.js:26` — which duplicates the
  repository's box-scan+atomic-write logic inline instead of delegating.
  Blocked from migrating it safely this session: **the existing unit
  test suite (`tests/unit/storageService.test.js`, ~1310 lines,
  `autoAssignSampleToBox` describe block ~L807-1142) asserts exact
  findOne/updateOne call counts and ordering via chained
  `mockResolvedValueOnce`** (pre-check read outside the transaction, a
  second fresh read inside it, then the atomic write). Delegating to
  `MongoStorageRepository.allocateSamplePosition` — which does its own
  internal re-fetch — would desync that call-count sequencing across
  most of the "concurrent write raced us" tests, not just superficially.
  A real migration needs the test suite's mocking strategy rewritten in
  the same change, which didn't fit safely in the remaining session
  budget. **Recorded this as a comment on #473** with two concrete
  options for next pickup ((a) rewrite the test mocking strategy as part
  of #473's scope, or (b) extract a shared low-level write helper both
  the service and the repository call, which needs fewer call-count
  changes). #473 left open, no code changes landed.

Ran `wrap-up` twice this session (once after the issue-filing checkpoint
fired mid-session, once at the end): no friction either time. The
scope-discovery loop (audit → split → attempt → deeper blocker found →
recorded, deferred) worked as intended; #473 stays open as the landing
point rather than the finding living only in chat.

## Repo state

- **`feature/docker-e2e-backend-integration`**: clean, pushed through
  `347af745` (HANDOFF rotation after #460). No new commits this session
  — #450's investigation and the #473 attempt produced only tracker
  writes (5 new issues + 2 comments); the `fix/473-*` branch was created,
  found nothing safe to commit, and was deleted again.
- **`fix/450-storageservice-repository-migration`**: still merged, still
  not deleted — carried forward again, still safe to delete. (Name is a
  near-collision with this session's `fix/473-storageservice-*` — they
  are unrelated; the old one predates this session's #450 work.)
- Issues: **#473, #474, #475, #476, #477, #478 opened** (this session,
  all depend-on or block #450). **#450 still open**, now the tracking
  issue for the 6-piece split (previously it was blocked on #454/#472
  from #460's findings last session — that dependency is unrelated to
  this session's split and still applies on top of it). **#472, #460**
  (from last session) still open/blocked, unaffected by this session.
  **#471/#469/#470/#467/#466/#465/#459/#464/#463/#462** closed (prior
  sessions). **#451, #454** still open.
- Backlog otherwise unchanged from last handoff:
  - **#451** (status consolidation + custody/storage entity design
    question) — still open, still a real design question.
  - **#454** — depends on #450/#452/#453 (#452/#453 done, #450 open,
    now itself a multi-issue tracking chain); doesn't cover
    `FacilityManagementPage.tsx` (that's #472's scope).
  - **#390** — still blocked (#460 remains, now blocked deeper than
    previously understood; #450 now expands into 6 more issues before
    it can close).
  - Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
    grep sweep (still not done), `test/440-retention-policy-model` and
    `test/441-retention-sweep-job` branches (merged, still not deleted),
    `fix/444-retention-period-iso8601` branch housekeeping (still carried
    forward, not re-checked).
  - dyeallpies-skills-pack#216, #210, #218, #220, #222, #223 still open,
    not yet applied.

## Dev stack state

Untouched this session — no Docker involved (research + one aborted
attempt, no runnable code changed).

## Blocking next step

None for picking a *different* issue. For **#473 specifically**: the
`autoAssignSampleToBox` migration needs either a test-mocking-strategy
rewrite done in the same change, or a redesigned shared-write-helper
approach that avoids the call-count mismatch — see #473's comment for
the two options. Don't attempt a naive "just call the repository method"
patch there without addressing this first; it will pass code review by
eye and then fail (or worse, silently desync) the existing test suite's
concurrency-race assertions.

## Recommended next steps

None explicitly queued by Dennis beyond "pick #450" (done — audited,
split into 6 issues, attempted the foundational one, found a real
blocker, recorded and deferred). Candidates, in likely priority order:

1. **#473** — re-scope with the test-mocking-strategy question resolved
   first (see "Blocking next step"), then implement.
2. **#475** — independent of #473, `label.routes.js`'s helper can be
   migrated to `GetSampleStorageLocationUseCase` today, no blocker found.
3. **#476** — needs Dennis's actual design call (quarantine =
   storage-position vs. separate state), not resolvable from docs alone
   per this session's read; worth surfacing directly rather than waiting
   for it to resurface at pickup.
4. **#474, #477, #478** — all depend on #473 landing first.
5. **#451** (status consolidation + custody/storage entity decision).
6. **#454**, **#390**, **#472**, **#460** — unchanged from last handoff,
   still downstream of the #450 family.
7. Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
   grep sweep, `test/440-*`/`test/441-*` branch deletion,
   `fix/444-retention-period-iso8601` housekeeping, stray
   `api/backend/out.txt` (still not investigated, many sessions running
   now), deleting `fix/450-storageservice-repository-migration`.

## Which skills to use

- `divide-and-conquer`'s design-split playbook worked as documented:
  confirm the breakdown with the user via `AskUserQuestion` before
  filing anything, file each piece with an explicit `Depends on:` line,
  comment the numbers onto the tracking issue, leave the tracking issue
  open. No friction.
- `agent-delegation`'s guard hook fired correctly on the first `Agent`
  call this session (blocked because the skill hadn't been invoked yet
  this session, despite its description being in context) — confirms
  the hook checks for an actual `Skill` tool call, not just topical
  awareness. Re-invoking it immediately unblocked the call. This is
  working as intended, not a bug to route around.
- Mid-attempt on #473, `resolve-issue`'s "cheapest check that answers
  the question" ladder paid off: reading the actual test file's exact
  mock-call assertions *before* editing the service caught a
  would-have-been-silent test-desync risk that a "read the service,
  write the migration, run the tests after" ordering would have found
  much later (or not at all, if the tests happened to still pass by
  coincidence on a different code path). Recommend continuing to read
  the tightly-coupled test file first whenever a service function has
  transaction/session-based tests before attempting a delegation-style
  refactor on it.
