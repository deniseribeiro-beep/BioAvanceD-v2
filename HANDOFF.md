# HANDOFF

**Written:** 2026-08-04, after resolving #385 on
`feature/docker-e2e-backend-integration`.

## What happened this session

Dennis said "Pick #385". Routed via `work-issue` → traced the issue's
real call sites before routing (per its "verify before deferring"
step) rather than taking the dict-07 gap description at face value —
confirmed the consumer side (`neo4jCanonicalProjection.service.js`)
already reads canonical `participantId`/`specimenId` everywhere, and
the only live producer caller (`consent.service.js`) already *sends*
`participantId`/`specimenId`. The actual defect was narrower than the
issue title suggested: `graphProjection.service.js` alone was still
building outbox payloads on `donorKey`/`sampleId` (and
`childSampleId`/`parentSampleId` for lineage), so `payload.participantId`
was silently dropped on every consent projection event (the method read
`payload.donorKey`, which the caller never sets). Routed to `fix-bugs`
(reproducible producer/consumer field-name mismatch, not a missing
capability — the canonical model already existed on both the caller and
consumer sides).

**Built:** renamed the payload/aggregateId field names across all four
`append*Event` methods in `graphProjection.service.js`
(`appendConsentEvent`, `appendLineageEvent`, `appendQualityEvent`,
`appendTelemetryEvent`) from `donorKey`/`sampleId`/`childSampleId`/
`parentSampleId` to `participantId`/`specimenId`/`childSpecimenId`/
`parentSpecimenId`. No dual-write, per dict-07's migration-table rule.
`appendLineageEvent`/`appendQualityEvent`/`appendTelemetryEvent` have no
live caller yet (grepped repo-wide, confirmed) — fixed for contract
consistency since they're the same file/same root cause, not scope
creep.

**Proof bar:** `api/backend/tests/unit/graphProjection.service.test.js`
— rewrote all field-name assertions to canonical names first (reproduced
the bug: 6 of 17 tests failed against old product code), then fixed
product code to make them pass (17/17 green). Also ran
`consent.service.unit.test.js` (103), `eConsent.routes.test.js` (22),
`neo4j-canonical-projection.service.test.js` (3),
`neo4j-outbox.service.test.js` (14), `neo4jProjection.worker.test.js`
(8) — all green, confirming no caller/consumer regression. Broader
`-t "graph|consent|Consent|neo4j|Neo4j"` sweep across the full backend
suite: 679 passed, 0 failed.

Branched `fix/385-graph-outbox-canonical-fields` off
`feature/docker-e2e-backend-integration`. Committed (`Fixes #385`),
pushed, merged `--no-ff` into the integration branch, pushed. Issue
branch deleted locally **and on remote** — the remote delete succeeded
without a permission prompt this time, consistent with `fix-bugs`'
already-documented observation that a branch pushed+merged within the
same session deletes cleanly (the denial pattern hits *other* sessions'
merged branches). Closed #385 with the merge-commit hash and the test
tally.

## Repo state

- **`feature/docker-e2e-backend-integration`**: now at `44783dc9` (was
  `b9ec2f28`), pushed to `origin`. One merge this session: `44783dc9`
  (graphProjection canonical-field alignment, commit `4d06f636`).
- No dangling branches — `fix/385-graph-outbox-canonical-fields` deleted
  locally and on remote. This handoff rotation itself lands via a small
  `test/385-handoff-rotate` branch (the branch-guard hook requires a
  `fix/`/`test/` branch for any edit alongside an untracked file, see
  below), merged the same way.
- An untracked `api/backend/src/storage/` directory is still present in
  the working tree — pre-existing, not created by this session, left
  untouched (carried forward from prior handoffs).
- Issues: **#385 closed** (this session). No new issues opened. Backlog
  unchanged otherwise: **#386–#387**, older backlog
  (`#371`/`#373`/`#374`/`#378`/`#379`), and **#389** (storage/custody
  split — route through `divide-and-conquer` first per its own body, 28
  files). #419's storage-hierarchy thread remains fully closed. #389
  still carries #401's deferred rename sub-question.

## Blocking next step

None.

## Recommended next steps

Dennis didn't name a specific next pick this session, so per this
skill's own rule: **none queued**. Backlog: **#386–#387**, older backlog
(`#371`/`#373`/`#374`/`#378`/`#379`), and **#389** (route through
`divide-and-conquer` first, 28 files).

## Which skills to use

- Backlog unchanged: **#386–#387**, older backlog
  (`#371`/`#373`/`#374`/`#378`/`#379`) — untouched this session, no new
  guidance beyond prior handoffs.
- **#389**: if picked up next, route through `divide-and-conquer` first
  per its own body (28 files, too big for one slice) — don't attempt as
  one iteration.
- **Any dict-07/RF gap that names a field-alignment or canonicalization
  issue**: don't take the issue title's framing of *which* file is wrong
  at face value — grep every real caller and consumer first. #385's
  title read as if the whole outbox pipeline lacked canonical fields;
  tracing calls showed the consumer and the only live caller already
  used them, narrowing the actual fix to one file's internal field
  names. This is the same "verify before deferring" discipline
  `fix-bugs` already documents, applied one step earlier, during
  `work-issue`'s routing/classification pass.
