# HANDOFF

**Written:** 2026-08-20, mid-sitting rotation. Picked up right after the
prior rotation's close (RF025/RF026 landed, RF029 split into #668-674).
Dennis said "continue rabbit hole... free to divide and conquer" — no
mid-workflow prompts. This checkpoint reflects state right after landing
**#669** (RF029 slice 1/6, the foundation); the session continues into
**#670** next within the same sitting, per the rabbit-hole skill's
"rotate before moving to the next item" rule — this is not necessarily
the sitting's final state.

## What landed since the last rotation

- **#669 (RF029 slice 1/6: ingestion gateway foundation) — shipped,
  merge `0d421c05`.** Built the generic machinery #670-674 all depend
  on: a provenance envelope (`ingestion/provenanceEnvelope.js`, field
  names reuse dict-02's `BaseRecord` vocabulary — `sourceSystem`/
  `createdBy`/`retrievedAt` — plus an ingestion-specific `purpose`); a
  generalized canonical-contract + alias + reference-existence validator
  (`ingestion/canonicalGateway.js`); an active-reference-code cross-check
  against `TerminologyConcept`/`ReferenceDatasetRelease`
  (`ingestion/activeCodeValidator.js`); an idempotency-key claim/replay
  mechanism (`ingestion/idempotency.js`, new `ingestionIdempotencyKeys`
  collection); a per-record quarantine model+lifecycle
  (`models/IngestionQuarantineRecord.js` + `ingestion/quarantine.js`,
  new `ingestionQuarantineRecords` collection) — all composed into one
  `ingestion/ingestionGateway.js#ingestRecord()` call. AC8 (audit+outbox)
  needed no new infrastructure, reused as-is. AC9 got a new architecture
  test (`tests/architecture/ingestion-civil-data-boundary.arch.test.js`)
  generalizing the existing per-call-site civil-data discipline into an
  automated scan, forbidden-field list derived from
  `contracts/canonical/v1`'s own schema rather than hand-duplicated.
  No entity is wired to the gateway yet (that's #670-673) — proven via a
  new NODE_ENV+shared-secret-gated test-support route
  (`interface/routes/ingestionTestSupport.routes.js`, same shape as
  `iot.routes.js`'s telemetry-monitor routes), exercised for real against
  the live Docker test stack in `pipeline-continuity.spec.ts` (RF029's
  own milestone spec). 62 new unit tests + 1 new architecture test + 3
  new real-backend e2e tests, all green. Full native suite re-run clean:
  **391/391 files, 7340/7340 tests** (up from 384/7282 — no
  regressions). `E2E_TRACEABILITY_PLAN.md`'s RF029 row updated to
  PARTIAL (1/6). Full writeup: #669's own closing comment and #668's
  "Slice 1/6 ... landed" comment.

## Two follow-ups filed this item (both open, neither blocking #670-673)

- **#675** — the new ingestion test-support route accepts a fully
  attacker-controlled body and persists it (quarantine path) — same
  NODE_ENV+secret gate as the existing `iot.routes.js` precedent, but a
  strictly more sensitive shape (write primitive, not just a trigger).
  Not urgent (no production deployment exists yet) but flagged for
  before one does, and for whether future entity slices should keep
  adding their own test-support routes the same way.
- **#676** — `activeCodeValidator`'s unversioned-code lookup (the common
  case — most real ingestion won't pin a `TerminologyConcept.version`)
  silently picks the newest-`validFrom` match on a tie. Asks whether
  that's the right default before #670-674 start depending on it, or
  whether an unversioned lookup should instead require exactly one
  active match.

Also filed **dyeallpies-skills-pack#354** (not this repo) — a
`build-loop` overlay addition: dict-02's `BaseRecord` ("Governança
transversal") entity governs shared cross-cutting field vocabulary
(provenance, audit metadata), not just per-entity field names the
existing overlay bullet already covers. Per skill-maintenance Rule 0,
filed as an issue rather than edited directly (this session is in the
consuming project, not the pack repo).

## Rabbit-hole state: still open, not exited

**#646 stays open** (RF029/#668 is the one Wave 3 RF not yet done) and
**so does #668** (5/6 RF029 slices remain: #670-674). This session is
continuing into **#670** (participants/consents/specimens/clinical, now
unblocked) next, within the same sitting — check git log / this file's
next rotation for whether that also landed before the sitting ended.
Both #646 and #668 carry full queue state; this file is a snapshot.

## Repo state (as of this rotation, before #670 starts)

- On `feature/docker-e2e-backend-integration`, 2 commits ahead of
  `origin/feature/docker-e2e-backend-integration` (#669's merge
  `0d421c05` + the `E2E_TRACEABILITY_PLAN.md` doc-fix merge on top) —
  not yet pushed. Working tree clean except the gitignored/junctioned
  `.claude/skills/` and the pre-existing untracked
  `api/backend/storage/assays/` (neither this item's doing).
- No PR to `main` exists.
- **Docker**: test stack (`compose.test.yml`) is up (core services +
  `admin-bootstrap-test`, `backend-app-test`/`frontend-app-test`
  rebuilt for #669's new source) and **deliberately left up** —
  #670 will need it again immediately. Tear-down deferred to whenever
  this sitting actually ends; don't let it idle unattended for hours
  (see `docker-workflow`'s local-env #160 precedent) — the session
  continuing immediately into #670 is why it's still up, not neglect.
- `test/669-rf029-ingestion-gateway-foundation` (#669's own slice
  branch) and `test/669-traceability-plan-update` (doc-fix) were both
  merged and deleted locally; neither was ever pushed remotely.
  `test/669-handoff-rotation` (this file's own branch) will be merged
  and deleted the same way immediately after this commit.
- The two pre-existing dangling local branches (`test/377-docs-on-main`,
  `test/human-showcase-video`) remain untouched, as before.

## Recommended next steps

Continuing into **#670** (participants/consents/specimens/clinical) this
same sitting per Dennis's "continue, free to divide and conquer"
instruction — not a deferred pick for a future session unless this
sitting gets cut off first, in which case: pick up #670 next (it's the
thinnest of the remaining 5 slices per #668's own design notes — canonical
contracts partially exist via `intakeWizard.js`'s 4 schemas already), then
#671 (telemetry) and #672 (files), both also described as thin wraps of
existing paths, then #673 (datasets/assays), with #674 (workflows/omics)
parked until RF027 is scheduled.
