# Backend coverage tracker

Purpose: let `test-loop` pick the next slice by reading this file instead
of running `npx vitest run --coverage` (~2-3 min, 258 files) at the start
of every session. This file is a snapshot, not a live number — it goes
stale as slices land and as source files change. Keep it honest:

- **Every commit that adds/extends a test for a file listed here must
  move that file to a truer bucket (or off the ZERO/LOW list) in the same
  commit.** Don't let the tracker and the code diverge silently.
- **Reconcile with a real coverage run periodically**, not every
  iteration: at the `ship-to-main` gate, or if a session's own targeted
  runs stop matching what this file claims (a sign of drift). Full
  regenerate command:
  `cd api/backend && npx vitest run tests/unit tests/integration
  tests/compliance --coverage --reporter=dot` — a bare `--coverage` run
  with no dir targets is blocked by `.claude/hooks/full-suite-guard.cjs`
  (per-iteration full-suite guard); explicit dir targets are the hook's
  own documented exception and produce an equivalent full-suite result.
  Then re-derive buckets from `coverage/coverage-summary.json`
  (`lines.pct` per file). `coverage/` is gitignored — this file is the
  durable record.
- **This file stays lean on purpose** — only the current buckets and the
  latest reconcile numbers. Slice-by-slice narrative (what each past
  slice covered, which issues it filed) is no longer duplicated into a
  separate history file — that content already lives permanently in
  `git log`/commit diffs and in filed GitHub issues, which don't rot the
  way a hand-maintained log does. `COVERAGE_HISTORY.md` was deleted
  2026-07-22 for exactly this reason; see
  `dyeallpies-skills-pack#95` for the rationale and the pending
  `test-loop`/testing-conventions skill update.

## Last full reconcile

**2026-07-22 (evening)**, snapshot from `test/withdrawal-model-coverage`
(`npx vitest run tests/unit tests/integration tests/compliance
--coverage --reporter=dot`, full suite).

Statements **90.8%** (16955/18672), Branches **81.84%** (13660/16691),
Functions **90.83%** (2052/2259), Lines **91.31%** (16319/17872) — up
from the afternoon reconcile's 90.33/81.3/90.34/90.9 (commit `fdd37e10`).
**Three of four dimensions (statements/functions/lines) remain past the
90% milestone** (`bioavanced-v2-conventions`); branches (81.84%) is
still the sole laggard, though it moved up 0.54pt this session.

Only **1 failing test** this run (`sample-graph-validator.service.test.js`
> "valida o nó de Integridade com sucesso e falha por tampering") — the
123-failures-across-5-files issue #244 called out in the prior
(afternoon) reconcile is **not reproducing**: `patient.model.unit.test.js`,
`sample.model.gaps.test.js`, `sample.model.unit.test.js`,
`sample.models.test.js` all pass now. Something between `fdd37e10` and
this session's HEAD fixed the participantId/identityDocument rename
drift in those 4 files (or the prior reconcile's failure was
environment-specific) — worth a quick look at whether issue #244 should
be closed; not re-investigated further this session since it's not
blocking coverage work.

This session's slice, `src/infrastructure/middleware/consent.enforcement.js`
(34 lines, no dedicated test file previously — only indirectly exercised
via `sample.routes.test.js`), moved from 86.66/41.66 (lines/branches) to
100/100/100/100 isolated. It was never listed in the buckets below
because those cutoffs are lines-based (>=85% lines = GOOD, not tracked);
its branch% was the real gap. **Since branches is the one lagging
dimension, a lines-only bucket sweep will keep missing files like this
one** — files at or above 85% lines but with a large lines/branches gap
are worth spot-checking directly via the reconcile's coverage-summary.json
sorted by branch%, not just by picking from the ZERO/LOW/MID-LOW buckets
below. Bucket lists below otherwise unchanged from the afternoon
reconcile (spot-checked; no bucket-membership shifts besides this file).

**Known limitation of this reconcile method — see issue #242**: for
files whose tests span both a Vitest-isolated unit test (plain ESM
`import`, or a `require.cache`-reload pattern) and an integration test
that loads the real `app.js`, the merged full-suite number can
understate real coverage significantly (not just a small swing — up to
~20 points), the same drift class as `dyeallpies-skills-pack#99`.
Confirmed this session for three files that looked like MID-HIGH
regressions but are actually fine in isolation: `equipment.routes.js`
(81.92/76.47 merged vs **100/92.94 isolated**, matches its prior
recorded entry and issue #238), `fieldEncryption.js` (76.19/82.6 merged
vs **100/100 isolated**), `User.js` (83.67/78.94 merged vs **98.03/97.89
isolated**). All three are corrected back into GOOD below rather than
listed as MID-HIGH candidates. **Before treating any MID-HIGH entry as a
real slice candidate, re-run that file's own test(s) alone with
`--coverage.include="<path>"` first** if it has both a unit and an
integration test file — don't trust the merged number for those.

**Follow-up slice (same branch, later commit, not yet reconciled into the
numbers above):** `src/infrastructure/middleware/audit.middleware.js` (243
lines, no dedicated test file previously — only indirectly exercised via
route-level integration tests) gained
`tests/unit/infrastructure/middleware/audit.middleware.test.js` (26 tests),
moving isolated coverage to 100% lines / 94.31% branches. Like
`consent.enforcement.js` above, it was never listed in the buckets below
because it was already >=85% lines (thin-line, low-branch gap invisible to
a lines-only sweep) — found via the same branch%-sorted spot-check this
note recommends. The rest of `src/infrastructure/middleware/` (`auth.js`,
`authConsent.js`, `rbac.js`, `integrationSecurityMiddleware.js`) already
has dedicated test files and wasn't re-checked this slice.

**Follow-up slice #2 (same branch, later commit, not yet reconciled into
the numbers above):** a fresh full reconcile run (`npx vitest run
tests/unit tests/integration tests/compliance --coverage
--reporter=dot`) confirmed the prior evening snapshot is still accurate
(90.89/81.96/90.88/91.34, +0.1pt drift, no bucket-membership changes) and
gave a live `coverage-summary.json` to branch%-sort directly. Top of that
sort was `src/routes/eConsent.js` (43.93 branch — already flagged above
as issue-#242 drift, not re-checked) and `src/config/queue.js` (50.00
branch — has a dedicated, comprehensive `queue.config.test.js`; confirmed
via an isolated re-run this is the same merged-vs-isolated drift class,
not a real gap). The next genuine (non-drift, no filed issue) candidate
was `src/services/consent.service.js` (87.86/68.61 lines/branches,
already >=85% lines so invisible to the lines-only bucket sweep, same as
the two middleware files above). Extended the existing
`tests/unit/consent.service.unit.test.js` (+29 tests, 88 total) covering:
`createTemplate`'s version/htmlContent/versionGroupId/caae fallback
branches, `updateTemplate`'s malformed-id throw and its
permissions/htmlContent/caae fallback-to-existing branches, `createPolicy`'s
invalid-period throw, previousPolicyId invalid-format/not-found throws and
its versionGroupId inheritance, `getPoliciesHistory`'s free-text/ativo/
inactive search-filter branches, and `createPatientConsent`'s
template-not-found/not-yet-vigente/expired throws. Moved isolated coverage
to 97.51/81.58/97.43/97.42. Remaining gap (lines 447,558,643,656) is
deeper error-path combinations, not whole untested methods — optional, not
urgent, same tier as `patient.service.js`'s note below.

**Follow-up slice #3 (same branch, later commit, not yet reconciled into
the numbers above):** next candidate from the same branch%-sorted list
was `src/interface/routes/result.routes.js` (87.61/59.09 lines/branches
isolated), confirmed as a real gap, not drift. Extended
`tests/integration/result.routes.api.test.js` (+3 tests, 55 total)
covering `getResultFileType`'s `.zip`/`.csv`/`.raw` branches (only
`.pdf`/an invalid extension were previously exercised), the
`equipmentID ? Number(equipmentID) : null` conversion branch, and the
download route's no-`filePath`-at-all 404 branch. Moved isolated
coverage to 87.93/62.72/100/87.61. **Most of the remaining branch gap in
this file is dead code, not a real gap**: the route-level `if (!db)`
503 checks (GET /, POST /upload, GET /:id, GET /:id/download, POST /,
PUT /:id, PUT /:id/link-sample, DELETE /:id) are all pre-empted by
`auth.js`'s own `if (!db)` 503 check inside `authenticate` — confirmed
by tracing one of the existing "503 when db unavailable" tests, which
passes but never actually executes the route body per branch coverage.
Likewise the multer `destination` callback's `if (!sampleID)` error
path pre-empts the route's own `!sampleID` check in `POST /upload`
before the route handler ever runs, and `sample._id ? ... : sampleID`
in the same route requires a Mongo doc without `_id`, which doesn't
happen in practice. None of these are worth chasing further in this
file — flag the same "route-level db-unavailable check is pre-empted
by auth middleware" pattern if it recurs in other route files during
future branch%-sorted spot-checks, since it likely caps achievable
branch% below 100 across most of `src/interface/routes/*`.

**Follow-up slice #4 (same branch, later commit, not yet reconciled into
the numbers above):** next candidate from the prior handoff's remaining
list was `src/interface/routes/phone-codes.routes.js` (60.86/93.61
branches/lines merged — already >=85% lines so invisible to the
lines-only bucket sweep, same class as `consent.service.js` above),
confirmed as a real gap. Extended `tests/integration/phone-codes.api.test.js`
(+7 tests, 11 total) covering the 503/500 error paths, the
short-term (<2 chars) regex-only branch, text/regex match dedup, the
`normalizePhoneCodeDocument` field-fallback and missing-dialCode/
countryName filter branches, and the limit query param's clamp-to-1/
clamp-to-50/default-to-20 branches. Moved isolated coverage to
97.95/89.13/100/97.87. **Remaining branch gap is the same
authenticate-shadows-route 503 dead-code pattern as #67/#76/#236/#246**
— confirmed by isolated coverage still showing the route's own `if
(!db)` line as unhit despite a passing "returns 503" test; filed as
issue #247 (fifth occurrence of the pattern).

**Follow-up slice #5 (same branch, later commit, not yet reconciled into
the numbers above):** next candidate from the prior handoff's remaining
list was `src/services/quality-compatibility.service.js` (65.51/100
lines/branches merged), flagged there as touching RCS/quality logic
(ground truth `docs/research/cmpb-submission/manuscript/00_Manuscript.tex`,
not `docs/architecture/`). On inspection it's a thin, pure legacy-field
compatibility shim (`normalizeSample`) with no scoring/grading math of
its own — the manuscript wasn't needed. No prior test file existed. Added
`tests/unit/quality-compatibility.service.unit.test.js` (11 tests)
covering: bare-call defaults, the no-legacy-fields no-op path, each of
`rcsScore`/`scoreBasedGrade`/`axisPenalties` promoting into `canonical`
individually and together, merging into a pre-existing `canonical`
object, not overwriting already-set `rcs_score`/`final_grade`/`p_bio`/
`grade_route`, preserving vs. defaulting `calculation_trace.compatibility`,
and no-mutation of the input. Every branch in the ~30-line function is
now exercised by inspection (isolated coverage run not re-confirmed
against a fresh full-suite reconcile this session — see next full
reconcile).

**Follow-up slice #6 (same branch, later commit, not yet reconciled into
the numbers above):** a fresh full reconcile (`npx vitest run tests/unit
tests/integration tests/compliance --coverage --reporter=dot`) gave
90.05/82.3/90.88/91.5 (statements/branches/functions/lines) and a live
`coverage-summary.json`, branch%-sorted directly per this file's
recommended method (buckets below no longer surface new candidates —
MID-LOW/MID-HIGH files are all issue-linked or flagged optional). Top of
that sort past the already-flagged/drift entries was
`src/interface/routes/master-data.routes.js` (71.87/91.42
branches/lines isolated), confirmed a real gap (not drift — 36 existing
tests but real branch gaps: not merged-vs-isolated mismatch). Extended
`tests/integration/master-data.api.test.js` (+3 tests, 39 total)
covering the `Number.isFinite(numericId)` fallback branch in the `$or`
id-lookup query (GET/PUT/DELETE `/:id` with a non-ObjectId numeric id
string like `"42"`, previously only exercised with valid ObjectId
strings). Moved isolated coverage to 91.42/84.37/100/91.42. Remaining
branch gap is the same authenticate-shadows-route 503 dead-code pattern
as #67/#76/#236/#246/#247 — confirmed via isolated coverage still
showing all 5 mounted routes' own `if (!db)` line as unhit despite 5
passing "returns 503" tests; filed as issue #248 (sixth occurrence,
accounting for 5 of the pattern's instances at once since one factory
is mounted 5 times). `quality.routes.js` (50/100 branches/lines,
flagged by the branch-sort as another candidate) was checked and ruled
out: its `req.body || {}` fallback is unreachable dead code too since
`express.json()` is applied globally in `app.js` before any route runs,
so `req.body` is never falsy — filed as issue #249.

**Issue #248 resolved (later session):** removed all 5 dead `if (!db)`
route-level guards from `master-data.routes.js` (`authenticate` already
503s first). Isolated coverage moved 91.42/84.37/100/91.42 →
98.33/100/100/98.33 branches now fully covered; remaining statement/line
gap is line 62 (unrelated).

**Issue #236 resolved (later session):** removed the dead `if (!db)`
route-level guard from `analysis-file.routes.js`'s `GET
/validate/:sampleIdentifier` (`authenticate` already 503s first for this
non-keepalive/non-MFA route). Isolated coverage on the file moved to
94.73/100/50/94.73 (branches now fully covered); remaining
statement/line gap is line 47 (unrelated), and the 50% function gap is
the module-level `router` factory call not counted as a hit function
(pre-existing, unrelated to this fix).

**Bucket lists below are freshly regenerated this session** off the new
`coverage-summary.json`, then corrected per the drift check above.
Cutoffs unchanged: ZERO = 0%, LOW = 1-49%, MID-LOW = 50-69%,
MID-HIGH = 70-84%, GOOD = >=85%.

## How to use this when picking a slice

1. **Check whether a candidate file is on the list above (broken by a
   filed issue) before treating its low number as an untested gap** —
   if so, skip it for slice-picking; it needs a fix, not a new test.
2. Among genuinely low-coverage files, prefer real-logic files over thin
   ones: `src/core/application/ports/*` (interfaces, zero logic) and
   `src/scripts/*` (one-off migration/seed scripts, not exercised in prod
   request paths) are low priority regardless of bucket.
3. This reconcile has real (non-drift) entries in every bucket again —
   ZERO/LOW/MID-LOW are no longer empty. Pick from LOW or MID-LOW first
   for the biggest jump per slice, same as before the 2026-07-05
   reconcile emptied them.
4. For a MID-HIGH (70-84%) file not already flagged above as
   issue-linked, the number here is trustworthy — no fresh isolated run
   needed before committing to it.
5. After landing a slice, delete the file's line from whichever bucket it
   was in (or move it, if now partial). Don't leave stale entries. The
   slice's own commit message is the narrative record now — don't add
   one here or to a separate history file.

## ZERO coverage (0% lines) — 17 files, confirmed unchanged in the 2026-07-22 (afternoon) reconcile, commit `fdd37e10`; `StoragePath.js` and `Withdrawal.js` moved to GOOD in prior sessions, `reference-data/essential/manifest.js` moved to GOOD this session (100/100/100/100 isolated)

Real logic, but broken-by-issue — see caveat above, not a real gap:
- `src/workers/worker.js` (self-executing bootstrap entrypoint — calls
  `startWorker()`/`process.exit` at module load; disproportionately
  expensive to test honestly, lower priority than it looks even once
  untangled from #147)

Low priority (models/interfaces/one-off scripts — thin or non-request-path):
- `src/core/application/ports/IAuditRepository.js`
- `src/core/application/ports/ILineageRepository.js`
- `src/core/application/ports/IPatientConsentReadRepository.js`
- `src/core/application/ports/IStorageRepository.js`
- `src/core/application/ports/IStorageTopologyReadRepository.js`
- `src/models/Cid.js`
- `src/models/Disease.js`
- `src/models/DrugDictionary.js`
- `src/models/Equipment.schema.js`
- `src/models/TemperaturePolicy.schema.js`
- `src/reference-data/essential/index.js`
- `src/scripts/migrate-rcs-governance-indexes.js`
- `src/scripts/migrateUserAnonIds.js`
- `src/scripts/seedDiseaseValidationRules.js`
- `src/scripts/testEnvironment.js`
- `src/services/orphanet/orphacodeApiClient.js` (issue #163 — routes.js
  returning 503 may be the same terminologySync gate; check before
  treating as a genuine gap)

## LOW coverage (1-49% lines) — 0 files, confirmed unchanged in the 2026-07-22 (afternoon) reconcile, commit `fdd37e10`

Sorted ascending (worst first) — lines% / branches%. All are the
same audit/rename-drift cluster (issue #146) already tracked; none are
genuinely untested slice candidates.

`audit-tree.service.js` moved to GOOD (100/100 lines/branches, isolated
run) — pure-function merkle-tree helper, no singleton dependencies to
mock. `audit-signing.provider.js` moved to GOOD (100/100/100/100,
isolated run) — mocked `env` module in place (mutable object, no
`vi.mock` needed), real Ed25519 keypairs via `crypto.generateKeyPairSync`
for the sign/verify roundtrips, and a real temp file for `loadPrivateKey`.
`audit-witness.service.js` moved to GOOD (100/100/100/100, isolated run)
— thin `fetch`-only singleton, `vi.stubGlobal('fetch', ...)` same as
`rfc3161-adapter.service.test.js`, no `vi.mock` needed.
`audit-tsa.service.js` moved to GOOD (100/100/100/100, isolated run) —
destructured `const { execFile } = require('child_process')` at module
scope, so mocked by overriding `child_process.execFile` directly
(built-in modules are real Node singletons — the override is visible to
the destructuring at require-time of the service) before the service's
first `require`, plus `vi.stubGlobal('fetch', ...)` for the TSA POST and
real `fs`/tmp-dir I/O (no fs mocking needed).

`intakeWizard.routes.js` moved to GOOD (100/90.9/100/100, isolated run) —
this is the thin `interface/routes` wrapper (auth/rbac wiring +
`intakeGovernanceResponseGuard`), distinct from `src/routes/intakeWizard.js`
which already had its own test file. New test mocks `auth`/`rbac` to
pass-through and stubs the inner router via `require.cache` injection, so
coverage isolates the wrapper's own logic: `buildSampleQuery`,
`resolveGovernanceStatus` (BLOCKED/QUARANTINE/AVAILABLE branches),
`buildSafeSampleSummary`, `enforcePersistedGovernanceStatus`, and the
response-guard's try/catch. Remaining branch gap (lines 73-77) is
`buildSafeSampleSummary`'s `governanceStatus.field || sample.field`
fallbacks — unreachable in practice since `resolveGovernanceStatus`
always returns fully-populated status fields on every call path; filed as
issue #243 (same dead-code pattern as #238), not a real gap.

`fhir-import-staging.controller.js` moved to GOOD (100/100/100/100,
isolated run) — thin controller delegating to
`fhir-import-staging.service.js`; mocked the service directly (no
`require.cache` tricks needed) and covered `stage`'s file-vs-body payload
branch, its JSON-parse-failure 400, and every method's error-path
statusCode/message fallback. Last file in the #146-cluster LOW bucket —
bucket now empty; a fresh full reconcile is due per the cadence note
below.

Genuinely low (no matching filed issue found) — real slice candidates:
none currently listed. Moved to GOOD (>=85%) since the 2026-07-14
reconcile: `PatientIdentityService.js`, `MoveSampleUseCase.js`,
`sampleIDGenerator.js`, `ReleaseSampleUseCase.js`,
`AllocateSampleUseCase.js`, `authConsent.js`,
`patientBiomarkerTimeseries.service.js` — all #146-family fixes landed.

## MID-LOW coverage (50-69% lines) — 3 files, confirmed unchanged in the 2026-07-22 (afternoon) reconcile, commit `fdd37e10`

Sorted ascending (worst first) — lines% / branches%.

```
src/workers/jobs/daily-merkle.job.js            60.00 / 52.17   (issue #159 — stale test mock)
src/services/audit-v2.service.js                60.81 / 43.75   (issue #146/#152 cluster)
src/services/neo4jCanonicalProjection.service.js 65.00 / 58.41  (issue #146 cluster)
```

Genuinely low (no matching filed issue found) — real slice candidates:
none currently listed. Moved to GOOD (>=85%) since the 2026-07-14
reconcile: `fhir.service.js`, `result-worker.js` (now MID-HIGH, see
below), `LineageRepository.js`, `analysisValidation.service.js`,
`import-lgpd.service.js`, `consent.validator.js`.

## MID-HIGH coverage (70-84% lines) — 5 files (plus 3 merged-vs-isolated drift cases below), confirmed in the 2026-07-22 (afternoon) reconcile, commit `fdd37e10`

Sorted ascending (worst first) — lines% / branches%. Not cross-checked
against filed issues line-by-line (MID-HIGH files are closer to "done"
regardless); a lower branch% relative to lines% usually means untested
error paths, a good tie-breaker when picking among these. The #228
batch-1 slices (orphanet.js, terminologies.routes.js,
MeasurementUnit.js, result.routes.js, analysis-type.controller.js,
auth.js, auditLogger.js, import-lgpd.controller.js,
clinical-unit.routes.js, logs.routes.js, sensor.controller.js,
User.js, reports.routes.js, MongoAuditRepository.js, createFirstAdmin.js,
mongo.js) plus `equipment.routes.js` (100/92.94 — issue #238 filed for
the remaining unreachable `if (req.user)` dead-code branches) have all
moved out of this bucket into GOOD — per-slice narrative for those is
in their commit history, not here.

```
src/services/mqtt-telemetry.service.js                         71.42 / 78.09   (issue #160 fixed & merged 2026-07-22 — this entry was stale, not broken-by-issue anymore. Remaining gap is lines 64-108, the real `mqtt.connect()` success path: TLS option wiring and the client's connect/error/message event handlers. Confirmed hard to cover honestly: the compiled `mqtt` package exports `connect` as a non-configurable getter, so neither `vi.mock('mqtt', ...)` nor `vi.spyOn(mqtt, 'connect')` can intercept it (`vi.mock` silently no-ops — `vi.isMockFunction` stays false — while `vi.spyOn` throws "Cannot redefine property: connect"); `require.cache` injection, the documented workaround this repo already uses for `ioredis` in Neo4jQuarantineService.test.js, crashed the vitest fork worker outright when tried here. A real (unmocked) `mqtt.connect()` call against a synchronously-rejecting protocol/port could work but risks flaky timers (reconnectPeriod 5000ms) if not torn down carefully — untried. Treat as an accepted gap, not a next-slice candidate, until someone works out a safe real-client approach)
src/services/patient.service.js                                77.92 / 65.52   (3-way test-writer fan-out landed 2026-07-22: encryption/clinical-unit, validation/duplicate, query/update/delete slices, 82 new tests across 8 test files/200 tests total. Two genuinely unreachable branches remain (issues #240, #241 filed) and branch% is still the weak dimension — remaining gaps are mostly deep error-path combinations, not whole untested methods; a further slice is optional, not urgent. Number moves slightly between this and the isolated-sibling-only run per the prior handoff — within the drift class noted above, not re-chased since both agree it's optional)
src/workers/workers/result-worker.js                           76.66 / 66.07   (issue #146/#164 — rename + yauzl)
src/services/SampleGraphValidator.js                           77.69 / 66.66   (issue #222 — legacy-schema migration, design fork)
src/workers/neo4jProjection.worker.js                          79.62 / 73.33   (remaining gap is the `require.main === module` CLI entry block, lines 82-99 — not coverable in-process, same accepted-gap pattern as createFirstAdmin.js)
```

Checked and corrected out of this bucket this session (issue #242 drift,
confirmed 100/GOOD in isolation): `equipment.routes.js`, `User.js`.

Note: `sample.service.js`, `import.service.js`,
`batch-validation-engine.service.js`, `audit.controller.js`, and
`audit-canonicalization.service.js` remain in GOOD as of the prior
reconcile — not re-verified line-by-line since they're well above the
MID-HIGH cutoff.

## GOOD coverage (>=85% lines)

Not listed here (lower priority for slice-picking by a wide margin; a
full reconcile regenerates this if needed). Ask for a fresh
`--coverage --reporter=basic` run if you need this detail.

## Maintaining this file

If `test-loop` finds this file stale (a listed ZERO/LOW file turns out
already well-tested, or vice versa), fix the entry in the same commit —
don't just work around it. If the reconcile cadence above stops making
sense (too frequent/rare), update it and say why in the session's
wrap-up. Detailed per-slice writeups belong in the slice's own commit
message, never back into this file.
