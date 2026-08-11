# HANDOFF

**Written:** 2026-08-11, end of session on `feature/docker-e2e-backend-integration`,
after resolving #495.

## What happened this session

Dennis said "pick #495" (frontend RCS/SPREC/storage consumer migration off
`Sample`'s embedded fields, filed under the dict-07/dict-08 series off
#390). **Routing:** `work-issue` → `resolve-issue` (feature/refactor, no
specialized-loop label match).

**#495's own stated premise turned out stale at pickup:** the issue said
it depended on backend RCS/SPREC/storage consumer migrations (#491, #493,
#494) "landing first" so the API responses would actually shape
entity-resolved data. #493/#494 are closed, but a full Explore-agent
audit (read-only, no edits) of the backend response-building code found
`GET /api/samples/:id` (and `listSamples`) **never resolves
RcsAssessment/SpecimenPreanalytics/StorageAssignment onto the sample
response at all** — those are only reachable via separate side-endpoints
(`GET /:id/rcs-assessments`, `GET /:id/sprec-profiles`,
`GET /storage/sample/:sampleId`). Also: of the 9 files #495 named, 3
don't read the embedded shape at all (`intake.service.js`,
`DataDictionaryPage.tsx`, `specimen.constants.d.ts`), and **none** read
RCS fields — the issue's own consumer audit was imprecise.

Routed through `divide-and-conquer`'s "issue turns out too big /
premature" playbook rather than forcing the full scope or declaring it
unactionable:

- **Delivered now** (branch `fix/495-frontend-storage-consumer-migration`,
  commit `40233640`, merged into `feature/docker-e2e-backend-integration`
  at `08d668ee`): migrated the **single-sample** storage/custody
  consumers — `InlineStorageMovementPanel.tsx`,
  `SampleWithdrawalReturnPage.tsx`, `SampleDetailsPage.tsx`'s storage
  section, and `ClinicalIntakeWizard.jsx`'s post-create label — off
  `sample.storageLocation` onto the already-working
  `GET /storage/sample/:sampleId` resolved-entity endpoint (the same one
  `SampleLocator.tsx` already used). Added `StorageAssignmentRecord` type
  to `frontend/src/types/models.ts` and a unit test
  (`SampleWithdrawalReturnPage.test.tsx`) for the migrated label-format
  logic. Verified via `npm run typecheck:full` filtered to touched files
  (see typecheck gotcha below — `npm run typecheck` alone would NOT have
  caught anything here) plus targeted vitest runs, both clean.
- **Filed as follow-ups**, each referencing #495 with an explicit
  `Depends on:` line:
  - **#517** — `SamplesPageView.tsx` (list view, both storage and SPREC
    display) — blocked on a batch/list resolution endpoint that doesn't
    exist yet; needs a design call (batch endpoint vs. server-side
    embed vs. accepted N+1).
  - **#518** — `SampleDetailsPage.tsx`'s SPREC display — blocked on a
    "current profile" resolution helper for `SpecimenPreanalytics`
    (only a list endpoint exists today; storage had a ready single-record
    one, SPREC doesn't).
  - **#519** — `sampleMerkleIntegrity.js` turned out to implement a
    **structurally different** Merkle algorithm than the backend's
    `MerkleService.generateSampleHash` (3-leaf tree over snake_case
    fields vs. a single flat hash over a differently-shaped object) —
    not just a stale-field-name issue. Confirmed it's currently
    orphaned/dead computation (the frontend-submitted `merkleRoot` is
    unconditionally overwritten server-side at `intakeWizard.js:524`,
    never compared) rather than a live integrity-check bypass — filed as
    a bug needing a design call on which algorithm should be canonical.
- **#495 closed** against the narrowed, delivered scope, comment lists
  #517/#518/#519 by number.

**Incidental reconciliation:** while checking #495's dependency claim on
#491, found #491's own tracking-issue body was never closed even though
all 5 of its split-out sub-issues (#497–#501) were already closed. Closed
#491 with a comment noting this — no new work, just closing a stale-open
tracking issue.

**New friction filed against the pack, not fixed this session:**
[skills-pack#233](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/233)
— `unit-test-loop`'s BioAvanceD-v2 overlay documents
`npm --prefix frontend run typecheck` as the per-iteration frontend
check, but that resolves to `typecheck:core`, whose `tsconfig` `include`
list is exactly 4 unrelated files. Running it against this session's 5
changed files reported a clean pass that checked **none** of them — only
`npm run typecheck:full` (filtered to the touched files, since it likely
has pre-existing unrelated repo-wide errors) actually verified the
change. Not editable from this repo (Rule 0), filed against the pack.

`wrap-up` ran twice this session (once after closing #495, again at
session end after the #491 close / merge / push / branch-delete) — the
skills-pack#233 finding above is the only friction that survived both
passes.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `08d668ee`, clean, up
  to date with origin. Contains the merge of #495's fix (`40233640`) plus
  the skills-pack asset deploy commit (`c7f75316`) that was already
  pending-push at session start.
- No dangling branches from this session —
  `fix/495-frontend-storage-consumer-migration` deleted both locally and
  remotely after a clean merge (both deletions succeeded without a
  classifier block).
- Issues this session: **#495 closed** (narrowed scope, merged at
  `08d668ee`). **#491 closed** (stale tracking issue, all sub-issues
  already done). **New:** #517, #518, #519 (all open, BioAvanceD-v2) and
  skills-pack#233 (open, pack repo).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward:

**#517** — `SamplesPageView.tsx` list-view storage+SPREC migration.
Needs a design call first (batch endpoint vs. server-side embed vs.
accepted N+1) — likely a `resolve-issue`/design-split shape, not a
straight implementation pickup.

**#518** — `SampleDetailsPage.tsx` SPREC migration. Needs confirming
whether a `SpecimenPreanalytics` "current profile" resolution helper
already exists (check for `sealedSpecimenPreanalyticsId` handling
alongside `MongoStorageRepository.findCurrentStorageAssignment`'s
precedent) before it's a straight implementation task.

**#519** — `sampleMerkleIntegrity.js` algorithm divergence. Needs a
design call (which Merkle shape is canonical) before implementation;
currently dead code, not urgent, but worth resolving rather than leaving
unexplained.

**skills-pack#233** — pack-repo only, low priority: fix the BioAvanceD-v2
overlay's per-iteration typecheck guidance to not silently under-check
frontend changes.

**#504** — the sealed-snapshot backfill script exists and is
unit-tested, but has not been *run* against any live environment.
Whoever next stands up a real Mongo instance with pre-#502 sample data
should run `node src/scripts/backfillSealedSnapshotPins.js` once
(idempotent, safe to re-run).

Other backlog carried forward unchanged from prior handoffs (not
re-verified this session):
- **#492's own note (SPREC on live registration):** the live
  `POST /api/samples` path still doesn't call
  `specimenPreanalyticsService.recordProfile` for the `sprec` payload it
  accepts for RCS computation.
- **#496** — remaining misc backend surfaces from
  `canonical-data-contract-v1.md`'s "Known Residual Legacy Surfaces"
  list not covered by #491-#495.
- **#489** — full-suite vitest flakiness. Not re-confirmed this session.
- Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
  grep sweep, dangling merged branches (`test/440-*`, `test/441-*`,
  `fix/444-retention-period-iso8601`, `fix/450-*`,
  `fix/476-quarantine-status-design-call`,
  `fix/485-sample-details-storage-migration`,
  `test/486-storage-move-sample`, `test/488-inline-storage-movement-e2e`,
  `test/507-storage-repository-canonical-return-shape`,
  `test/508-storage-usecases-canonical-assignment`,
  `test/509-storage-service-canonical-assignment`,
  `test/510-sample-service-canonical-storage-assignment`,
  `test/511-intake-wizard-canonical-storage-assignment`,
  `fix/512-quarantine-storage-scope-not-applicable`,
  `fix/513-smoke-check-script`,
  `fix/515-test-smoke-cjs-graph` — all safe to delete, low priority
  housekeeping, not re-verified this session).
- **Next e2e slice** (per `E2E_TRACEABILITY_PLAN.md` and
  `playwright-specs`' spec inventory) — check issue #95's tracking
  thread.
- **#368** — the analogous Patient/ParticipantIdentity migration that
  #390's split pattern mirrored — is itself still unsplit.
- **#390** — umbrella issue; with #491 now also closed, tracks #492,
  #493 (closed), #494's follow-ups (all closed), and #495 (closed,
  narrowed — #517/#518/#519 carry the remainder) collectively. Worth a
  fresh look next session at whether #390 itself should close or get a
  status comment, now that four of its five direct children are done.

## Dev stack state

Nothing started this session. All verification ran `npm run
typecheck:full` (filtered) and targeted `npx vitest run` invocations
from `frontend/` — no Docker, no live app, no backend changes at all
(this was a frontend-only slice).

## Which skills to use

- `work-issue` → `resolve-issue`: #495 was a refactor/enhancement issue,
  no specialized-loop label matched (not a bug, not a coverage gap, not
  an unbuilt spec'd capability, not a rewrite item).
- **New this session:** when an issue's own "depends on X landing"
  premise cites other *closed* issues, don't take that as proof the
  dependency is actually satisfied in the way the issue assumes — #495
  cited #491/#493/#494 as closed-therefore-safe, but #493/#494 only
  migrated *internal* backend consumers (services, not the API response
  shape itself), and #491 turned out to still be open at the time despite
  all its sub-issues being done. Check the actual current code (here: the
  GET response-building path) rather than trusting a dependency issue's
  closed/open state as a proxy for what it actually changed.
- **New this session:** a tracking issue with all its split-out
  sub-issues closed doesn't auto-close itself — worth a quick
  `gh issue view <sub>` sweep on any tracking issue referenced mid-session
  (not just the one being worked) to catch this cheaply, same shape as
  the #491 finding here.
- **New this session:** `unit-test-loop`'s per-project overlay can
  document a check command that silently no-ops on most real changes
  (skills-pack#233) — if a "clean" typecheck/lint run feels suspiciously
  fast or the command name has a `:core`/`:fast`-style suffix, check what
  its config actually includes before trusting a green result as
  coverage of the files just changed.
