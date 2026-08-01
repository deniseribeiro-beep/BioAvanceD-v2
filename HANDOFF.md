# HANDOFF

**Written:** 2026-08-01, after closing #370 (Foundation Data Pipeline /
FoundationDataRun) on `feature/docker-e2e-backend-integration`.

## What happened this session

Picked up **#370** ("expand Foundation Data Pipeline to full
929-element/six-entity dictionary + FoundationDataRun model"). Re-scoping
(divide-and-conquer) found the issue conflated two separable pieces, and
that most of what it assumed unbuilt already existed:

- Five of the six "technical entities" dict-09's changelog names
  (`ReferenceDatasetRelease`, `ReferenceImportRun`, `ReferenceImportIssue`,
  `TerminologyConcept`, `TerminologyRelation`) were already built under
  RF028 (#367, expanded in #373). Only **`FoundationDataRun`** was
  actually missing.
- Wiring the full 929-element dictionary's schemas/collections/indices is
  gated on each domain's own canonical-model migration landing first —
  not something this issue could own.

**Built and merged** (`test/foundation-data-run` → this branch,
`6a6c8513`/`f5daf68f`): the dedicated `FoundationDataRun` model
(`src/models/FoundationDataRun.js`, dict-02 P1X-0395..P1X-0413), migrated
`seed-essential-reference-data.js` to write one `FoundationDataRun`
document per pipeline execution (steps, checksums, `previousRunId` chain,
sanitized failure path) instead of #366's per-manifest-entry
`referenceSeedRuns` rows. Verified against the real dev-stack backend:
idempotent reference-data upserts across repeat runs, correct
`previousRunId` chaining, both RF022 assertions in
`pipeline-continuity.spec.ts` passing live (the second now asserts
`foundationDataRuns`, not `referenceSeedRuns`).

**Follow-up issues filed while closing #370** — its close comment
initially claimed several domain gaps were "already tracked
independently" without verifying; a wrap-up audit caught this and a
correction comment on #370 lists what was actually checked:

- **#381** — produce a machine-readable 929-element canonical dictionary
  catalog (dict-02 v1.3.0), so "929 elements verified" becomes a checkable
  gate.
- **#383** — Specimen/SPREC/RCS/storage/custody separation (`Sample.js`
  still one mixed document) — no issue existed for this before today.
- **#384** — eConsent.js's legacy `POST /update` route still bypasses the
  canonical ConsentTemplate/Consent flow — no issue existed before today.
- **#385** — Neo4j outbox payloads still key on `donorKey`/`sampleId`
  instead of canonical `participantId`/`specimenId` — no issue existed
  before today.
- **#386** — RBAC still keyed on static `accessType`/`roleName`, not
  normalized `Role`/`Permission`/`UserRoleAssignment` — no issue existed
  before today.
- **#387** — audit logging has no canonical `AuditEvent` contract or
  retention policy, just `Log.js` aliases — no issue existed before today.
- **#382** — unrelated pre-existing bug found while unit-testing:
  `hpo-sample.jsonl`'s pinned checksum breaks on a Windows checkout
  (CRLF via `core.autocrlf=true`, `.gitattributes` doesn't pin `*.jsonl`
  to `eol=lf`), failing 4 of 5 tests in
  `tests/unit/reference-imports/pipeline.test.js`. Not fixed this
  session — it's a `fix-bugs`-shaped repro-then-fix, out of scope for
  this slice. One other test file may also have failed transiently in a
  full-suite run (not reproduced in isolation, identity unconfirmed —
  see this session's transcript if it recurs).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `f5daf68f`, working
  tree clean, **not yet pushed** (ahead of `origin` by 4 commits — the
  prior session's unpushed HANDOFF rotation, `6a6c8513`, `1b270c4b`,
  `f5daf68f`). Push is Dennis's call, not done automatically this
  session.
- Docker dev stack (`compose.dev.yml`) was brought up this session to
  verify the FoundationDataRun bootstrap — teardown decision (via
  `clean-up`) still pending as of this writing.
- Issues: **#370 closed** (with a correction comment). **#381, #383,
  #384, #385, #386, #387, #382** all open, newly filed this session.
- `test/foundation-data-run` (the working branch, now merged) still
  exists locally/possibly remote — safe to delete, not deleted (Dennis's
  call).

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis.

## Which skills to use

The five new architecture-gap issues (#383-#387) are each a dict-07/dict-08
row in isolation — likely `divide-and-conquer` or `build-loop` sized
individually (each needs its own scoping pass, not assumed to be one
sitting). #381 (dictionary catalog) is probably a single `build-loop`
sitting. #382 (CRLF checksum fixture) is a small, well-diagnosed
`fix-bugs` candidate. Older backlog from prior handoffs
(`#371`/`#373`/`#374`/`#375`/`#376`/`#378`/`#379`) is unchanged — still
open, not touched this session.
