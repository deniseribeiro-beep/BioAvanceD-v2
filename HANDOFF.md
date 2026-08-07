# HANDOFF

**Written:** 2026-08-07, end of session on `feature/docker-e2e-backend-integration`,
after splitting and closing #494.

## What happened this session

Dennis said "pick #494" — the storage/custody consumer-migration issue
(9 listed files) that prior handoffs had carried forward as "still
unsplit."

**Routing:** `work-issue` → `divide-and-conquer` (design-split
playbook). No code was edited this session; the deliverable was entirely
tracker state.

**Re-audit before splitting:** rather than trusting the issue's own
9-file consumer list at face value, ran a read-only Explore agent
(gated by `agent-delegation`, invoked fresh this session) to confirm
which consumers still actually do direct `Sample.storageLocation` field
access. Result: 3 of the 9 were already resolved or not applicable —
`api/backend/src/interface/routes/intakeWizard.routes.js` (migrated
post-#450, only a passthrough remains), `NotificationService.js`,
`sensor.controller.js`/`sensor.service.js` (their `locationId` refs are
equipment/sensor-location filters, unrelated to Sample custody fields).
Also surfaced a real dependency chain the flat issue-body list didn't
show: `MongoStorageRepository.js`/`MongoStorageTopologyReadRepository.js`
are the concrete `IStorageRepository` implementation, and their
**return shape** is what every downstream consumer (including the
use-cases, which already call through the port correctly) still embeds
raw `storageLocation` fields from.

**Split confirmed with Dennis via AskUserQuestion** before filing
anything (6-issue, foundational-first option). Filed:

- **#507** — MongoStorageRepository/MongoStorageTopologyReadRepository
  return-shape migration. Foundational; #508/#509 depend on it.
- **#508** — AllocateSampleUseCase/MoveSampleUseCase/ReleaseSampleUseCase
  consuming the new shape. Depends on #507.
- **#509** — storageService.js allocate/release orchestration off direct
  `storageLocation.boxId/position` access. Depends on #507, #508.
- **#510** — sample.service.js creation-time `storageLocation` write
  (pre-existing `#474` comment already flagged this). Independent.
- **#511** — intakeWizard.js (route handler, not `intakeWizard.routes.js`
  which is already migrated) raw field assembly at ~lines 579-609.
  Independent.
- **#512** — scope question on `equipment-sensor-quarantine.service.js`'s
  `location`/`storageLocation` usage: looks like quarantine-domain
  matching, not core custody-split scope, but needs an owner call before
  a migration issue is filed for it either way.

Closed **#494** with a comment naming all 6 follow-ups, the 3
already-resolved consumers, and the target-pattern doc pointer
(`docs/architecture/canonical-data-contract-v1.md`, "Known Residual
Legacy Surfaces" / "Deferred Cleanup Plan", PR 101 — "Canonicalize
specimen, custody and storage flow"). #390 remains the umbrella tracking
issue for #491/#492/#493/#494's collective follow-ups.

`wrap-up` ran in full: no code touched (no scope-check needed), no lazy
fixes, no permission denials, no stale instructions, no user correction.
One expected mechanical block — called `Agent` before invoking
`agent-delegation` this session, got hard-blocked, then invoked it
correctly — that's the gate working as designed, not a finding. No
orphaned "deferred" language: the 3 not-applicable consumers were
independently confirmed resolved (not just assumed), and the one real
ambiguity (#512) got its own open issue rather than living only as a
comment on the now-closed #494.

## Repo state

- **`feature/docker-e2e-backend-integration`**: unchanged this session
  — no commits, no pushes. Still clean and up to date with origin as of
  the prior session (#506, merge commit `61000f3f`).
- No branches created or deleted this session (tracker-only work).
- Issues this session: **#494 closed** (split + tracking comment). New
  issues filed: **#507, #508, #509, #510, #511, #512** (all `enhancement`
  label, all reference #494 as originating issue, dependency chain noted
  above).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

If picking from this session's own output: **#507 is the natural
starting point** — it's the foundational piece #508 and #509 both
depend on, and the return-shape decision it makes will bound how #508
gets implemented.

Other candidates carried forward from prior handoffs (not re-verified
this session):

**#504** — the sealed-snapshot backfill script exists and is
unit-tested, but has not been *run* against any live environment.
Whoever next stands up a real Mongo instance with pre-#502 sample data
should run `node src/scripts/backfillSealedSnapshotPins.js` once
(idempotent, safe to re-run).

**#491** stays open as the tracking issue for the RCS-consumer
migration (separate from #494's storage/custody scope).

**#390** — the umbrella issue; now tracks #491, #492, #493 (closed),
and #494's 6 follow-ups (#507-#512) collectively. Worth checking next
time whether #390 itself should be updated to reflect #494's closure
and the new sub-issue numbers, or whether that's implicit via #494's
close comment.

Other backlog carried forward unchanged from prior handoffs (not
re-verified this session):
- **#492's own note (SPREC on live registration):** the live
  `POST /api/samples` path still doesn't call
  `specimenPreanalyticsService.recordProfile` for the `sprec` payload it
  accepts for RCS computation.
- **#495** — frontend consumers, including `sampleMerkleIntegrity.js`.
  **Depends on #491, #493 (done), #494's follow-ups landing first.**
- **#496** — remaining misc backend surfaces from
  `canonical-data-contract-v1.md`'s "Known Residual Legacy Surfaces"
  list not covered by #491-#495.
- **#489** — full-suite vitest flakiness. Not re-verified this session.
- Older backlog: `#371`/`#373`/`#374`/`#378`/`#379`, `user.accessType`
  grep sweep, dangling merged branches (`test/440-*`, `test/441-*`,
  `fix/444-retention-period-iso8601`, `fix/450-*`,
  `fix/476-quarantine-status-design-call`,
  `fix/485-sample-details-storage-migration`,
  `test/486-storage-move-sample`, `test/488-inline-storage-movement-e2e`
  — all safe to delete, low priority housekeeping).
- **Next e2e slice** (per `E2E_TRACEABILITY_PLAN.md` and
  `playwright-specs`' spec inventory) — check issue #95's tracking
  thread once skills-pack#227 lands the new spec in the inventory.
- **#368** — the analogous Patient/ParticipantIdentity migration that
  #390's split pattern mirrored — is itself still unsplit.

## Dev stack state

Nothing started this session. No product code touched, no Docker/Mongo
needed for issue triage and filing.

## Which skills to use

- `work-issue` → `divide-and-conquer`'s design-split playbook: when an
  issue's own consumer list hasn't been re-audited recently, a read-only
  Explore agent (gated through `agent-delegation`) before designing the
  split caught 3 stale list entries and one real dependency chain the
  flat list didn't show (repository return-shape is foundational; the
  use-cases already call through the port correctly and just consume the
  old snapshot shape). Re-verify a filed migration issue's file list
  against current code before splitting it, not just before fixing it.
- `agent-delegation`'s gate fired as designed this session (`Agent` call
  blocked until the skill was invoked fresh) — confirms the hook is
  live and the "invoke every session, not once" rule holds even for a
  single research fan-out.
