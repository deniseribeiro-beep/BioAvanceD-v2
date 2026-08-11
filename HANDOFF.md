# HANDOFF

**Written:** 2026-08-11, end of session on `feature/docker-e2e-backend-integration`,
after resolving #526.

## What happened this session

Dennis said "Read handoff and pick next task" — no specific issue named.
The prior handoff flagged **#526** as the freshest, most concretely
scoped candidate (mirrors #524's fix shape almost exactly), so
`work-issue` routed it to **`build-loop`** (route 4: names a capability
missing from the code entirely, needs the product fix built together
with the real-backend test proving it).

**#526 resolved this session** (`test/526-fhir-import-staging-rcs-sprec-wiring`,
merge commit `29d8dd6a`, fix commit `2a8fee9d`). Mirrored #492/#502/#503/
#505/#524's established pattern: `fhir-import-staging.service.js#commitBatch`
now calls `rcsAssessmentService.recordAssessment`/
`specimenPreanalyticsService.recordProfile` and pins
`sealedRcsAssessmentId`/`sealedSpecimenPreanalyticsId` on the committed
sample — but **only on a genuine insert** (the upsert's `upsertedId`),
since this path uses `updateOne(..., {upsert: true})` rather than a
plain `insertOne` like the other four creation paths, and a commit that
only matches an already-existing `specimenId` doesn't write fresh
`rcsPreview`/`sprec` data via `$setOnInsert` either — recording on every
match would grow duplicate versioned snapshots for no reason. Two new
real-backend (mocked-Mongo-with-real-matching-semantics) tests added to
`tests/integration/fhir-import.test.js` proving both the insert-time
recording and the no-duplicate-on-rematch behavior.

**One bundled root-cause fix, discovered while writing the proving
test:** `calculateRcsPreview` computed a real per-axis `sprec` object
(via `buildRcsPayload`) but discarded it before returning —
`rcs-certification.service.js`'s own `calculation_trace` never echoed it
back — so the pre-existing `sprec: normalized.rcsPreview?.calculation_trace?.sprec
|| {}` write had *always* evaluated to `{}` for every FHIR-imported
sample, predating #526 entirely. Fixed by having `calculateRcsPreview`
return `{ ...result, sprec: payload.sprec }`; both the embedded
`sample.sprec` copy and the new `SpecimenPreanalytics` snapshot now
carry real data, for fluid-matrix specimens. Kept in-scope for #526
(not split out) because it directly blocked #526's own acceptance
criteria — recording an empty snapshot wouldn't have proven anything.

**Filed #527** (not fixed): solid-matrix specimens still record a
`SpecimenPreanalytics` snapshot with null axis fields — `parseSprecRaw`'s
solid branch names its fields `collectionType`/`warmIschemia`/
`coldIschemia`/`fixationType`/`fixationTime`, while
`SpecimenPreanalyticsModel.fieldsOf` (and the fluid branch) expect
`primaryContainer`/`preCentrifugation`/`centrifugation`/
`secondCentrifugation`/`postCentrifugationDelay` regardless of matrix
type. Same shape as #392's already-resolved fluid/solid relabeling gap;
likely fix is wiring `frontend/src/constants/sprecDictionary.js`'s
existing dictionaries in, not new parsing. Kept out of #526 to keep that
slice narrow.

**Two more issues filed from an unrelated full-suite sanity check**
(`npx vitest run`, no directory scope, run twice this session — both
runs reproduced the same two failures, not flaky):
- **#528** — `tests/unit/user.model.unit.test.js` fails 6/6 with
  `UserModel.isValidAccessType`/`getRoleName is not a function`. Both
  methods are gone from `UserModel` (removed by #432, "drop
  accessType/roleName fields... sweep remaining references") but this
  test file wasn't swept. Stale-test shape, not a regression — likely
  routes to `fix-bugs` with the "update the test, don't restore the
  method" direction, possibly repointing at
  `rbac-assignment.service.resolveRoleDisplayName` per #427's precedent.
- **#529** — `tests/unit/scripts/generate-dictionary-catalog.test.js`'s
  source-vs-artifact drift check fails: a freshly generated catalog
  checksum doesn't match the checked-in canonical-dictionary artifact's
  stored checksum. Not investigated further; possibly related to #391
  (line-ending drift on the same file) but that was a git-status-noise
  fix, not a content mismatch, so likely a separate cause.

Neither #528 nor #529 matches #489's tracked symptom shape (JWT/
encryption-secret failures at ~89-file scale) — confirmed by reading
#489's own body before filing, so these are new, not duplicates.

**One workflow-tooling finding, filed against the skills-pack repo**
(`DyeAllPies/dyeallpies-skills-pack#238`): `tests/integration/fhir-import.test.js`'s
local hand-rolled `createCollection()` mock didn't replicate two real
MongoDB driver behaviors product code across this repo depends on —
`insertOne` mutating the passed-in doc in place to add `_id` (the mock
returned a detached copy instead, so `rcsAssessmentService.recordAssessment`'s
return value's `._id` read back `undefined`), and `updateOne(...,
{upsert:true})` returning `upsertedId` on a genuine insert (the mock
always returned a flat `{matchedCount:1, modifiedCount:1}`, giving
product code no way to distinguish insert from match). Fixed locally in
that one test file (commit `2a8fee9d`); filed for the pack's
`vitest-specs` BioAvanceD-v2 overlay since other local (non-`db.factory.js`)
collection mocks in this repo could have the same gap. Could not edit
the overlay directly per Rule 0 (only editable from a session in the
pack repo itself).

**Also fixed while adding the two new tests:** the pre-existing "commit
salva somente registros READY_TO_COMMIT" test's `samples.updateOne`
call-count assertion (was 1, now 3 — the main upsert plus the two new
sealed-id pins) — updated in the same commit, not a separate finding.

**No security-relevant findings this session** — the new recording calls
reuse the same best-effort, internal-only write path every other
creation path already uses; no new route, no relaxed validator, no
trust-boundary change.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `29d8dd6a`, clean, up
  to date with origin. Contains the merge of #526's fix.
- No dangling branches from this session's own work
  (`test/526-fhir-import-staging-rcs-sprec-wiring` deleted locally
  post-merge; never pushed on its own).
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged): local — `fix/476-quarantine-status-design-call`,
  `fix/477-bulk-import-storage-allocation`,
  `fix/481-autoassign-precheck-repository`,
  `fix/485-sample-details-storage-migration`,
  `fix/513-smoke-check-script`, `test/377-docs-on-main`,
  `test/428-rbac-retire-legacy-fields`,
  `test/431-jwt-payload-accesstype`, `test/440-retention-policy-model`,
  `test/441-retention-sweep-job`, `test/486-storage-move-sample`,
  `test/507-storage-repository-canonical-return-shape`,
  `test/508-storage-usecases-canonical-assignment`,
  `test/509-storage-service-canonical-assignment`,
  `test/510-sample-service-canonical-storage-assignment`,
  `test/511-intake-wizard-canonical-storage-assignment`,
  `worktree-agent-a8ad1494700a4a20e`. Remote —
  `fix/349-user-organization-picker` (still present as of last check via
  `git ls-remote`; deletion denied by the permission classifier in the
  #349 session, not re-attempted since).
- Issues this session: **#526 closed** (fix + real-backend tests merged
  at `29d8dd6a`). **#527 opened** (solid-matrix SpecimenPreanalytics
  field-naming mismatch, same shape as #392). **#528 opened** (stale
  `UserModel.isValidAccessType`/`getRoleName` test, methods removed by
  #432). **#529 opened** (dictionary-catalog checksum drift).
  **skills-pack#238 opened** against `DyeAllPies/dyeallpies-skills-pack`
  (Mongo mock `insertOne`/`updateOne` semantics finding — not a
  BioAvanceD-v2 issue).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per this
skill's "only if the user explicitly said so" rule, nothing is queued.

Candidates carried forward from prior handoffs, plus this session's new
issues:

- **#528** — stale `UserModel` test, methods removed by #432. Small,
  clearly-scoped, likely a quick `fix-bugs` pickup.
- **#529** — dictionary-catalog checksum drift. Needs investigation
  first (re-run the generator, diff against the checked-in artifact) —
  root cause unknown.
- **#527** — solid-matrix `SpecimenPreanalytics` field-naming mismatch.
  Same shape as the already-resolved #392 — check
  `sprecDictionary.js`'s existing relabeling before writing new mapping
  logic.
- **#525** — 4 additional RCS/SPREC/storage-custody consumers found by
  #496's re-audit (`label.routes.js`, `reports.routes.js`,
  `neo4j-canonical-rebuild.js`, `batch-validation-engine.service.js`).
  Likely routes to `resolve-issue`/a small migration slice per file.
- **#390** — umbrella; all originally-tracked sub-issues closed, plus
  #496 (audit) and now #526 also closed. Still not re-assessed whether
  it should close or get a status comment — carrying forward again, now
  with #525/#527/#528/#529 as candidates that may want to hang off it,
  or not, depending on scope.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed. Distinct from this
  session's #528/#529 — don't conflate.
- **#386** — RBAC still keyed on `accessType`/`roleName` per dict-07,
  open, not re-triaged this session.
- **#336** — still open: is `import.controller.js#importFhirBundle`
  dead code to remove, or does something still call it?
- Older backlog, unchanged: `#371`/`#373`/`#374`/`#378`/`#379`, `#368`,
  next e2e slice per `E2E_TRACEABILITY_PLAN.md`/`#331`.
- **skills-pack#233/#234/#235/#236/#237/#238** — pack-repo only, low
  priority, unchanged (plus this session's new #238).

## Dev stack state

Nothing started this session. `build-loop`'s "real backend" proof bar
for a backend-internal slice (not the milestone's own e2e Playwright
spec) is a mocked-Mongo integration test with real query-matching
semantics, not literal Docker — matches what
`tests/integration/fhir-import.test.js` already does. No Docker/live-DB
needed or used this session.

## Which skills to use

- `work-issue` → `build-loop` (route 4) was correct for #526 — a
  capability named in an issue but missing from the code entirely,
  proven with a real-backend test built alongside the fix. No misroute.
- **New this session:** when a build-loop slice's proving test exposes a
  second, smaller bug the fix's own test can't pass meaningfully without
  fixing (here: `calculateRcsPreview` discarding the `sprec` object it
  already computed) — fix it in the same commit rather than shipping a
  technically-passing-but-empty snapshot, but stop there: a deeper,
  separate-judgment-call issue found in the same area (the solid/fluid
  field-naming mismatch) still gets its own issue rather than expanding
  the slice further. The line: fix what's needed to make *this* slice's
  own acceptance criteria real; file what would require its own design
  call.
- **New this session:** before trusting a hand-rolled Mongo collection
  mock's `insertOne`/`updateOne` return values in a test file that
  doesn't use the shared `tests/factories/db.factory.js`, check whether
  it replicates the real driver's `insertOne`-mutates-in-place and
  `updateOne`-returns-`upsertedId`-on-insert behaviors — confirmed via
  skills-pack#238 this mismatch costs real debugging time and the
  in-memory-mock convention this repo's build-loop overlay already
  prescribes.
- Confirmed again: a fix/build branch only merged locally (never pushed
  on its own) needs no remote branch-delete step.
- `gh issue list --search "<keyword>" --state all` before filing paid
  off four times this session (#527/#528/#529, and re-checking #489's
  own body before concluding #528/#529 were new, not duplicates).
