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

**2026-07-23**, snapshot from `feature/docker-e2e-backend-integration`
(commit `f3c258c9`, `npx vitest run tests/unit tests/integration
tests/compliance --coverage --reporter=dot`, full suite, exit 0 — no
failing tests).

Statements **91.54%** (17049/18624), Branches **83.37%** (13850/16611),
Functions **90.96%** (2053/2257), Lines **91.98%** (16396/17824) — up
from the 2026-07-22 evening reconcile's 90.8/81.84/90.83/91.31. This
fold-in captures the `label.routes.js` (68.29% -> 100% branches
isolated) and `sample.routes.js` (68.62% -> 90.84% branches isolated;
remaining gap confirmed as a `@vitest/coverage-v8` phantom-branch
artifact, not a real gap — see the "Follow-up slice #9" note below)
session merged at `18ba9f35`. **Three of four dimensions
(statements/functions/lines) remain past the 90% milestone**
(`bioavanced-v2-conventions`); branches (83.37%) is still the sole
laggard, though it moved up 1.53pt this session.

Bucket lists below were not regenerated this reconcile (board-hygiene
pass only, done to answer issue #228 — no new slice was picked from
them). Next session picking a slice should regenerate off a fresh
`coverage-summary.json` per the method above rather than trust these
buckets blind, since two sessions' worth of slices have landed since
the 2026-07-22 afternoon regeneration.

## Branch-focused priority list toward the 90% branches milestone

Branches (83.37%, 13850/16611) needs **~1100 more covered branches**
to cross 90% (14950/16611) — a multi-session lift, not a single slice.
This list exists because the lines-based ZERO/LOW/MID-LOW/MID-HIGH/GOOD
buckets below miss it: a file can sit at 90%+ lines and still carry a
large branch gap (same pattern as the `consent.enforcement.js` /
`audit.middleware.js` follow-ups earlier in this file). Regenerated
2026-07-23 from a fresh `coverage-summary.json`, sorted by absolute
branch gap (`total - covered`) — gap size, not percentage, is what
moves the aggregate number fastest per slice.

**Excluded — already blocked by a filed issue or a documented design
call, don't re-pick these as "genuinely low" candidates without first
reading the linked context:**
`audit-v2.service.js` / `neo4jCanonicalProjection.service.js` (issue
#146/#152 cluster), `SampleGraphValidator.js` (issue #222, legacy-schema
design fork), `patient.service.js` (issues #240/#241, optional/deep
error-path only), `mqtt-telemetry.service.js` (accepted gap — `mqtt`'s
`connect` export can't be mocked, see MID-HIGH entry above),
`result-worker.js` / `daily-merkle.job.js` (issue #146/#164/#159),
`queue.js` / `eConsent.js` (issue #242 merged-vs-isolated drift class —
re-check isolated coverage before trusting the merged number for
either).

**Phase 1 (top gap, unblocked, real candidates — pick in this order):**

```
gap  branch% lines%  file
141  82.5%   93.9%   src/services/import-lgpd.service.js  (partial slice landed 2026-07-23, session 4: importPatientsSmart/buildMappedPatientRow branches — clinicalUnit-present fillAcronym call, PatientModel.validate() rejection path (e.g. missing sex), and the responsavelNome/responsavelEmail explicit-mapping-target fallback (set vs. already-mapped) — via tests/unit/import-lgpd.service.importPatientsSmart.unit.test.js. Note: the fallback only fires when a mapping explicitly targets the literal key `responsavelNome`/`responsavelEmail` — the more common accented-column path (`responsavelnome` etc.) resolves straight to `representativeName`/`representativeEmail` via canonicalHeaderMap and never touches that fallback. File is 1693 lines; remaining gap is scattered across earlier parse helpers (parseSampleRow ~1150-1310, parsePatientRow ~1160-1200) plus a few defensive branches — no single large block left.)
 86  77.66%  92.8%   src/routes/intakeWizard.js  (partial slice landed 2026-07-23, session 6: isolated branches 77.66% -> 86.49% (299/385 -> 333/385) via tests/unit/intakeWizard.helpers.test.js + tests/unit/intakeWizard.routes.test.js — buildSampleDocumentFromIntake/buildPharmacologyData/normalizeNumber fallback branches, ensureConsentEmailSent's success/failure paths, resolveConsentDecision's no-identifier throw, sensor/equipment maintenanceStatus-fallback matching, storage-box BLOCKED/full-occupancy skip + Map-based occupancyGrid, canonicalViolations non-object guard, and patient-match's $or/ACTIVE-status-default branches. Filed #255: `collectNonCanonicalFields` and `ensureConsentEmailSent` are dead code (never called from any route, only reachable via `router._test`) — accounts for part of the remaining gap. Remainder is a mix of genuine small gaps (e.g. equipment status via maintenanceStatus-only fallback, empty box rows/cols, non-numeric locationID skip) and likely some `@vitest/coverage-v8` phantom-branch artifacts on guard-clause `if`s without `else` blocks (same class as the `sample.routes.js` follow-up noted above) — not re-verified this session.)
```

`src/interface/routes/auth.routes.js` partial slice landed 2026-07-23 session
12: extended `tests/integration/auth.routes.test.js`-adjacent coverage via new
`tests/integration/auth.routes.branch-coverage.test.js` (+8 tests) — the
`(req.t && req.t(key)) || '<pt fallback>'` truthy branch (same class as
`sample-file.controller.js` session 11) across most of its ~29 occurrences,
login's `mfaCode` compat fallback, and `DELETE /sessions/:sessionId`'s
sessionId-matches-current-session cookie-clear branch. Isolated branches
69.67% -> 72.9% (108/155 -> 113/155). Two real findings from this slice:
(1) five route handlers' own `if (!db)` guards (`/two-factor/status`,
`/verify`, `/sessions`, `/sessions/all-others`, `/sessions/:sessionId`) are
structurally unreachable — `authenticate` middleware
(`src/infrastructure/middleware/auth.js:64-73`) performs the identical check
first for any non-keepalive/non-MFA-setup route and returns its own 503
before the handler runs, so these branches can never execute via a real
request; only `/refresh` (no `authenticate`) and `/keepalive` (middleware
explicitly skips its own check for this route) can reach their local
`if (!db)` guard. (2) Several other real, reachable branches (e.g. `/refresh`'s
`if (!refreshToken)` at line 426, the token-type/session-mismatch guards at
lines 444/454, `/sessions/:sessionId`'s cookie-clear `if` at line 387) were
independently confirmed via a plain `node -e` script (bypassing vitest
entirely) to execute correctly and produce the expected response — but
`@vitest/coverage-v8` still reports 0 hits for them, including when the
exact matching test is run in complete file isolation. Suspected root cause:
this suite's `delete require.cache[authRoutesPath]` + fresh `require()`
pattern (needed because `authController.*.bind()` happens at require time)
recompiles the route module as a new V8 script per test, and coverage-v8
doesn't reliably merge/retain branch hit-counts across those repeated
compilations for certain multi-line `if` blocks — not a missing-test gap.
Not chased further this session; worth a `@vitest/coverage-v8`-focused
investigation (or an isolate-modules alternative to the require-cache-delete
pattern) before trusting this file's branch number again.

`src/routes/dictionary.js` closed out 2026-07-23 session 12: extended
`tests/unit/dictionary-medications-disease-profile.test.js` and
`tests/unit/dictionary-search-suggest.test.js`, and added
`tests/unit/dictionary.branch-coverage.test.js` (+22 tests) covering
`normalizeMedicationRecord`'s field-fallback chains (code/name/generic_name/
atc_level_1/atc_classifications derivation, falsy-array-item filtering),
`normalizeLocalPhenotype`/`normalizeLocalBiomarker`'s code/display fallback
chains, `buildLocalSemanticSuggestions`'s terminology-row `system`/`sistema`
and dedup/no-data-found paths, and the `/suggest` Neo4j-success-path
display fallbacks plus its nested fallback-error-message branch. Isolated
branches 78.66% -> 97.07% (188/239 -> 232/239). Filed #261 for the
remaining 7-branch gap: 3 confirmed structurally unreachable (dead
defensive code, same class as #260) and the rest are the usual
guard-clause-with-no-else phantom-branch artifact plus one unexplained
single branch not worth chasing further.

`src/controllers/sample-file.controller.js` closed out 2026-07-23 session 11: extended
`tests/unit/sample-file.controller.test.js` (+21 tests, 67 total) covering the
`req.t ? req.t(key) : '<pt fallback>'` truthy branch across all 38 occurrences
(only the falsy/no-`req.t` branch had ever been exercised) plus the
`specimenIdString` ternary's non-ObjectId-string fallback in
`downloadFile`/`deleteFile` — isolated branches 69.66% -> 84.83% (124/178 ->
151/178). Remaining 27-branch gap confirmed to be the same
`@vitest/coverage-v8` phantom-branch artifact noted repeatedly in this file's
history (guard-clause `if`s with no `else`, e.g. `if (!db) { return ... }` —
V8 emits an uncoverable synthetic "else" location with empty start/end) —
verified directly against `coverage/coverage-final.json`'s `branchMap`, not
just inferred; not chased further.

`src/routes/orphanet.js` closed out 2026-07-23 session 11: extended
`tests/unit/orphanet.routes.test.js` (+5 tests, 27 total) covering
`normalizeDiseaseRecord`'s name/synonym fallback chains (`Synonym` entries
using `Label`/`_`/plain-string instead of `label`; name resolution via
camelCase `preferredTerm` and finally the bare ORPHA code when no name field
exists at all) and `dedupeRecords`' reverse-merge direction (second record
supplying CID10/OMIM/relacoes/synonyms/aliases the first record lacks, not
just the other way around) — isolated branches 82.65% -> 90.75% (143/173 ->
157/173). **Filed issue #259**: a doc with no ORPHA-derivable code field
crashes the whole `/api/orphanet/search` request with a 500 instead of being
silently excluded — `searchLocal`'s `.map(normalizeDiseaseRecord...)` can
produce `null` entries, and `dedupeRecords`'s loop re-normalizes each
`record` via `normalizeDiseaseRecord(record, ...)` without a `null` guard,
so `record = null` reaches `item = {}`'s default parameter (which only
covers `undefined`, not `null`) and crashes on `item.ExternalReference`. The
new test asserts the actual 500, with a comment pointing at #259. Remaining
gap is a mix of the same phantom-branch class (`requestedLang` is always
truthy per the route's own `lang || 'pt'` default, so its ternary's falsy
branch is dead code reachable only by calling `searchLocal` directly) and one
apparently-unreachable branch (`record?.source` in `dedupeRecords` — every
caller already normalizes records before they reach it, so they always carry
a `source`) — not chased further.

`src/interface/routes/terminologies.routes.js` closed out 2026-07-23
session 7: no prior test file existed, added
`tests/unit/terminologies.routes.test.js` (33 tests) covering both routes
(`GET /`, `POST /sync`) end-to-end with a mocked `db`/`fetch` — isolated
branches 67.04% -> 87.12% (177/264 -> 230/264). Exercised the fallback
chains in `buildTerminologyFromCid`/`buildTerminologyFromOrphanetDisease`/
`normalizeExternalReferences`/`normalizeOrphaApiResult` (alternate field
names, multi-code splitting, object-vs-array externalReferences), the
local-redundancy hydration cascade (cids -> orphanet_diseases, capped by
`limit`), the live Orphadata fallback (enabled/disabled, missing base
URL, fetch rejection, AbortError timeout, non-ok HTTP response with/
without a message field, malformed payload shapes for
`extractOrphadataResults`), and both routes' 503/500 error paths. Three
lines remain uncovered (159, 212, 387) — each is a `.length === 0` early
return that's unreachable given the callers' own truthy-payload guards
(same guard-clause-with-no-real-else class documented elsewhere in this
file); not chased further.

`src/services/batch-validation-engine.service.js` closed out 2026-07-23
session 8: extended `tests/unit/batch-validation-engine.service.test.js`
and `tests/unit/batch-validation-engine.unit.test.js` (+34 tests, 109
total) covering the entire, previously-untested `readXlsxRows` block
(header-row mapping, empty-worksheet skip, blank-cell/blank-row skip),
`readRowsFromFile`'s unrecognized-extension fallback chain (CSV fails ->
JSON succeeds; CSV and JSON both fail -> XLSX succeeds), `readJsonRows`'s
scalar-payload `[]` return, `buildPatientLinkageQuery`'s non-numeric
recordNumber skip and rawRow-objectId fallback, `buildBiomarkerObservationPayloads`'s
no-value-token warning and specimen/patient identifier fallback chains,
`persistPatient`'s malformed-email and unparseable-birthDate rejections
plus the mappedRow-over-rawRow precedence, a non-`Error` rejection's
message fallback in `persistSample`'s catch, `detectDataType`'s
no-args-supplied default, and `processBatchImport`'s `samples`-dataType
dispatch with a fully-valid warning-free row (VALID branch, previously
only PARTIAL/INVALID were exercised at that level). Isolated coverage
87.63/82.40/93.33/88.20 -> 98.65/90.52/100/99.15 (stmts/branches/funcs/lines).
Remaining 3 uncovered lines (431, 715, 939) are a `forEach` default-param
guard, a compound optional-chaining fallback (`patient._id || ''`), and
the file's own `module.exports` line — same always-executed-but-reported-0
`@vitest/coverage-v8` artifact class documented elsewhere in this file;
not chased further.

Phase 1 alone covers ~943 of the ~1100-branch gap if fully closed —
in practice expect a meaningfully smaller real yield, since some
fraction of any file's branch gap turns out to be dead/unreachable code
(the `if (!db)` 503-guard pattern already resolved 6 times — #67/#76/
#236/#246/#247/#248 — is exactly this) rather than a genuine test gap.
Treat each file as "confirm real gap via isolated coverage first,
same #242 caveat as everywhere else in this file," not as guaranteed
yield.

`src/services/terminologySync.service.js` closed out 2026-07-24: extended
`tests/unit/terminologySync.service.test.js` (+22 tests, 45 total)
covering `normalizeRecord`'s OMIM double-prefix guard, sistema derivation
from `system`/`source`/`tipo`, OMIM normalizedCodigo field fallbacks
(`OMIM`/`omim`/`omimCode`), `sinonimos`'s plain-`synonyms`-array and
`Synonym`-object-array (`Label`/`_`/plain-string) branches and its
none-present empty-array default, `findExternalReference`'s
lowercase-field and `code`/`id`/`value` fallbacks, `upsertOrphanetRedundancy`'s
aliases/sinonimos dedup-merge (the `.map` callback was never invoked
before), the ORPHA-`normalizedCodigo` lowercase `record.orpha` fallback,
`extractRecords`' `{data:[]}`/`{items:[]}`/`{results:[]}` body shapes, a
bare string/number record-entry stub-normalization path, and
`fetchJsonWithTimeout`'s non-OK-response error/message-field vs.
plain-HTTP-status-message branches (previously entirely untested).
Isolated branches 79.27% -> 93.24% (176/222 -> 207/222). Remaining gap is
mostly dead code: `upsertOrphanetRedundancy`'s own `if (!db)` guard
(line 147) is unreachable since callers always pass a valid db by the
time it's invoked, and its `if (!code)` guard (line 151) is unreachable
because `payload.codigo` is already guaranteed non-empty (and already
ORPHA-normalized) by `upsertTerminology`'s required-fields check before
this function ever runs — same dead-guard class as #67/#76/#236/#246/
#247/#248 but not filed separately since this one isn't a route-level
503 guard (and non-`db` callers of this internal helper don't exist —
no HTTP-request-level fix would apply here). The one remaining uncovered function (line 229, the
`setTimeout` abort callback in `fetchJsonWithTimeout`) needs a real
15-second timer to fire and wasn't chased — low value for a single
function point.

**Phase 2 (next tier, same exclusions apply):**

```
gap  branch% lines%  file
 44  74.71%  94.0%   src/services/equipment-sensor-quarantine.service.js
 43  80.09%  92.7%   src/services/user-security.service.js
 40  73.50%  98.4%   src/services/auth.service.js
 36  77.07%  90.3%   src/controllers/auth.controller.js
 35  76.35%  95.5%   src/controllers/audit.controller.js
 33  81.46%  92.5%   src/services/storageService.js
 32  70.09%  95.0%   src/controllers/consent.controller.js
 32  81.81%  100.0%  src/services/hl7.service.js
 30  83.24%  90.9%   src/services/rcs-certification.service.js
 29  87.42%  97.5%   src/controllers/paciente.controller.js
 28  90.42%  99.1%   src/interface/routes/reports.routes.js
```

Regenerate this list after Phase 1 lands rather than working stale
numbers — several Phase 2 entries will shift once Phase 1's shared
helpers (e.g. `import.service.js`/`import-lgpd.service.js` likely share
validation branches) get exercised incidentally.

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

**Issue #235 resolved (later session):** removed the dead
`assertExpectedCollectionName` self-check and its unreachable throw
branch from `MongoAuditRepository.js`'s `appendImmutableAudit` — both
arguments were hardcoded literals at the single call site (no way to
reach the mismatch branch). Git history confirmed it was leftover
defensive scaffolding added alongside the append-only isolation Proxy
wrapper (commit `d01f7ff6`), not a stub for missing variable-collection
wiring: the repo never used the `CANONICAL_COLLECTIONS`/env-override
config for this collection name, before or after that commit. Isolated
coverage on the file is now 100/95.83/100/100
(stmts/branches/funcs/lines) with the dead branch removed; the remaining
95.83% branch gap is an unrelated `get()` trap ternary (line 23),
pre-existing and unrelated to this fix.

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
   needed before committing to it. **Exception (issue #242):** if the
   file has both a Vitest-isolated unit test (plain ESM `import`, or a
   `require.cache`-reload pattern) and an integration test that loads
   the real `app.js`, the merged full-suite number can understate real
   coverage by up to ~20 points — re-run that file's own test(s) alone
   with `--coverage.include="<path>"` before treating a MID-HIGH entry
   as a real slice candidate.
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

Note: `sample.service.js`, `import.service.js`, `audit.controller.js`, and
`audit-canonicalization.service.js` remain in GOOD as of the prior
reconcile — not re-verified line-by-line since they're well above the
MID-HIGH cutoff. `batch-validation-engine.service.js` closed out its own
Phase 1 branch-gap entry this session (see note above).

## GOOD coverage (>=85% lines)

Not listed here (lower priority for slice-picking by a wide margin; a
full reconcile regenerates this if needed). Ask for a fresh
`--coverage --reporter=basic` run if you need this detail.

**Follow-up slice #7 (2026-07-23, same branch):** a fresh full reconcile
(`npx vitest run tests/unit tests/integration tests/compliance --coverage
--reporter=dot`) gave 91.34/82.77/90.96/91.81
(statements/branches/functions/lines), 1 known pre-existing failure
(`sample-graph-validator.service.test.js` tampering test, same as prior
reconciles). Branch%-sorted directly per this file's method; next
candidate off the prior handoff's remaining list was
`src/services/hl7Audit.service.js` (66.66/92.45 branches/lines isolated
— confirmed real gap, not drift, via an isolated re-run first). Extended
`tests/unit/hl7Audit.service.test.js` (+7 tests, 17 total) covering:
`_hashFHIRResources`'s catch branch (both an `Error`-with-`.message` and
a plain-string throw, to hit the `err.message || err` fallback),
`_hashHL7Files`'s equivalent catch branch for a disk-read failure, and
`buildHL7HashesForDate`'s item-without-sampleId/fileId skip branch (logs
a warning via `continue`, doesn't block remaining items). Moved isolated
coverage to 100/100/100/100. `label.routes.js` (68.29/97.64) and
`sample.routes.js` (68.62/92.21) were also confirmed real gaps (not
drift) this session but not yet worked — next candidates.

**Follow-up slice #8 (2026-07-23, same branch):** worked
`label.routes.js` (68.29/97.64 branches/lines isolated). Extended
`tests/unit/label.routes.test.js` (+19 tests, 32 total): the ObjectId
`_id` query variant in `findSample`, `resolveStoragePathText`'s
box-not-found/no-storageLocation/boxID-legacy-field/readable-fallback
branches, `buildLocationText`'s locationID/position/all-absent
branches, both routes' `error.status`-vs-`statusCode`-vs-default-500 and
message-fallback branches, and `buildLabel`'s sampleId
fallback chain (`sampleID` -> `_id.toString()` -> raw `_id` -> `''`).
Added a `router._test` export (`findSample`, `resolveStoragePathText`,
`buildLocationText`, `normalizeString`) for branches unreachable through
the two HTTP routes alone (the same pattern `intakeWizard.js` already
uses) — no product behavior changed. Moved isolated coverage to
100/100/100/100.

**Follow-up slice #9 (2026-07-23, same branch):** worked
`sample.routes.js` (68.62/92.21 branches/lines isolated, the largest
route file in the repo at ~1090 lines / 25 routes). Extended
`tests/unit/sample.routes.test.js` (+50 tests, 104 total): every
`validateCreateSamplePayload` branch (all 6 non-canonical alias fields,
each MIABIS enum-invalid case, `isRareDisease`/`linkedProject`
type-checks, the `locationID` numeric-string/positive-number branches,
and a genuinely-`undefined` `req.body`), the `POST /` actor-construction
fallback chains (`req.user` id/`_id`/`userID`, name/username,
role/roleName, `req.ip`/`x-forwarded-for`/`req.connection.remoteAddress`)
and its `req.t`/error-status/error-message fallback branches, the
`GET /:id/label` sampleId/barcode/sampleType fallback chain, `PUT /:id`'s
`sample_release` audit-log branch (all three trigger conditions), and
four previously-missing `503`/`500` tests
(`GET /:id/label`, `GET /search/by-term`, `GET /by-barcode/:barcode`,
`GET /by-barcode/:barcode/symbology-assets`). Added a `router._test`
export (`validateCreateSamplePayload`) for the one branch unreachable
through HTTP (Express itself defaults `req.body` to `{}`, so the
`req.body || {}` fallback needs a direct call, same `router._test`
pattern as `label.routes.js`) — no product behavior changed. Also
restructured the test file's `loadRoute()` to require every dependency
and the route itself exactly once (stable proxies/constructors reading a
mutable `current*` closure variable per test) instead of clearing
`require.cache` and re-requiring the ~1090-line route fresh per test —
faster, and ruled out (though did not fix, see below) a suspected
coverage-measurement quirk.

**Follow-up slice #10 (2026-07-23, same branch, session 5):** worked
`src/services/sample.service.js` (73.13/85.2 branches/lines isolated,
Phase-1 list above). Extended `tests/unit/sample.service.test.js`
(+30 tests, 46 total) covering: `normalizeRequiredLocationID`'s
whitespace-only and non-numeric-string branches, `createSample`'s
auto-generated `specimenId` path, the `quantity` type-strictness check
(a numeric *string* passes the model's `Number(quantity) > 0` check but
fails the service's own `typeof !== 'number'` re-check), the
linked-equipment lookup (both not-found and found-and-registered), the
sensor-operational check (missing sensor and a `maintenance`-status
sensor, including the status-in-message branch), the physical-position
`Occupied`-marking success path, auto-generated `barcode`, `withdrawSample`'s
and `returnSample`'s barcode-fallback lookup, catch/error-propagation
paths for `getSample`/`listSamples`/`updateSample`/`deleteSample`/
`getSampleByBarcode`/`getSampleMovements`, `getSampleByBarcode`'s
case-insensitive/numeric/regex fallback strategies and its
no-participant and single-word-name branches, `returnSample`'s
missing-quantity and observations-required branches, and
`getSampleMovements`'s object-like (`toString()`) specimenId branch.
Moved isolated coverage to 95.82/82.98/94.73/96.06.

Found two real bugs while writing these, both left as-is per the
loop's no-product-code rule — new tests assert the current (buggy)
behavior with a comment referencing the issue:
- **Issue #252**: `withdrawSample`'s barcode-fallback lookup calls
  `this.getSpecimenByBarcode` (doesn't exist on the class — only
  `getSampleByBarcode` does, which `returnSample` calls correctly) —
  throws a `TypeError` instead of falling back.
- **Issue #253**: `createSample`'s participantId format guard
  (`!validateParticipantId(sampleData.participantId)`) calls the async,
  two-arg `validateParticipantId(db, participantId)` with only one
  argument — `!aPromise` is always `false`, so the guard never fires;
  a malformed id falls through to the real (correctly awaited)
  existence check two lines later and comes back as 404 "não
  encontrado" instead of the intended 400 "inválido".

Remaining branch gap (lines 105-106, 115-117, 121-123, 135, 139, 143,
296) is dead code, not a real gap: 105-106 is an `else if
(typeof validation.errors === 'string')` fallback that
`SampleModel.validate` can never produce (always returns an array);
115-117/135/139/143 are the service's own re-checks of
participantId-presence/sampleType/sampleOrigin/extractionProtocol,
already unreachable because `SampleModel.validate` (called first)
rejects all of those cases itself; 121-123 (the intended 400 throw) and
296 (the line after the #252 `TypeError`) are unreachable specifically
*because* of issues #253 and #252 above — confirmed via the two bug
regression tests, not assumed.

Moved isolated coverage to 99.43% statements / 90.84% branches / 100%
functions / 99.42% lines — **not** 100% branches, and that remainder is
not a real gap: `@vitest/coverage-v8`'s v8-to-istanbul conversion
reports the implicit "else" of a **no-`else` `if`** as 0 hits even when
the fall-through path is demonstrably exercised (confirmed by cross-
checking statement-level hit counts on the lines immediately after the
`if` block, and by testing repeated-fresh-require vs. require-once —
identical numbers either way, ruling out the require-cache pattern as
the cause). label.routes.js's no-`else` `if`s happened to get inferred
correctly; sample.routes.js's ~14 near-identical `if (!db) {...}` /
`if (!result) {...}` guards did not. Confirmed via `branchMap`: the
phantom alternate location has `{"start":{},"end":{}}` (no real source
range for v8 to sample), so the 0 isn't fixable by adding more tests —
only by giving the `if` a real `else` branch in the source, which is
out of scope for a test-only loop. 28 of the remaining uncovered
branches are this pattern; the other 2 uncovered lines (963, 1094) are
similarly always-executed statements (an audit-payload object literal
immediately before a passing 200 response, and the file's own
`module.exports`) that this tooling still reports as 0. Flag this
pattern to Dennis if the 90% branches milestone needs literal 100% on
this file — it would require adding real `else` blocks to ~14 guard
clauses in `sample.routes.js`, a product-code change out of test-loop's
scope.

`src/services/fhir-import-staging.service.js` closed out most of its Phase 1
branch gap 2026-07-23 session 9: extended `tests/integration/fhir-import.test.js`
(+20 tests, 35 total — no dedicated unit test file existed; controller/consent
tests already mocked the service directly). Covered: `stageBundle` with an
unavailable db, `getBatch` with an `ObjectId` instance and a not-found batch,
`getConsentStatus`'s persisted-vs-fallback-to-`buildWorkflowSnapshot` field
resolution, `attachExternalDocument` end-to-end (not-found 404, success with/
without `note`/`userID`) — previously entirely untested at the service level,
`validateBatch`'s COMMITTED/CONSENT_SEND_FAILED skip and its PENDING_CONSENT/
VALID-with-warning branches, `sendConsents`'s COMMITTED/READY_TO_COMMIT skip,
blocking-validation-error skip, and missing/invalid-email-at-send-time
NEEDS_REVIEW path, plus several pure-helper fallback chains (`extractIdentifier`
without a preferred-system match, `extensionValue` via `valueCode`, disease/
biomarker/phenotype coding-only fallbacks, and `parseSprecRaw`'s solid/tissue
branch including solid+processing-unknown). Moved isolated coverage
91.26/85.36/95.16/92.62 -> 95.14/89.30/96.77/96.17 (stmts/branches/funcs/lines).
**Filed issue #256**: `decorateRecord()` is dead code — defined but never
called anywhere in `src/` or `tests/`, its logic already duplicated inline at
each real call site. Remaining branch gap is a mix of that dead function
(lines 287-297), the `audit()` helper's insert-failure catch branch (not
exercised since the mock `audit_logs.insertOne` never rejects), a couple of
`?? '')` optional-value fallbacks on rarely-populated fields, and what looks
like more instances of the guard-clause-with-no-real-else phantom-branch
artifact already documented elsewhere in this file (e.g. `attachExternalDocument`'s
own `if (!record)` still shows as branch-incomplete despite both outcomes
having a passing test) — not chased further this session.

`src/services/import.service.js` closed out most of its Phase 1 branch gap
2026-07-23 session 9 (same session as the `fhir-import-staging.service.js`
slice above): extended the file's five existing unit test files (+12 tests,
102 total). Covered: the CSV-import mirror of several JSON-only branches
(`importPatients`'s no-identifier skip, merge-birthDate-conflict error),
`mergePatientData`'s array-append and nested-object-merge branches (both
previously untested regardless of JSON/CSV), `importLocations`'s entire CSV
branch beyond the two happy/structural-error paths already tested (parse
error, model-validation error, existing-locationID conflict, auto-generated
locationID, and a per-row `insertOne`-throws catch), a same-class per-row
`insertOne`-throws catch for `importTemperature`, and `readSpreadsheetRows`
(previously entirely untested) covering the empty-worksheet `[]` return and
the rich-text/hyperlink-object and `Date`-instance cell-value normalization
branches. Moved isolated coverage 89.93/79.14/97.82/89.92 ->
95.65/84.35/97.82/95.78 (stmts/branches/funcs/lines). One planned assertion
(a literal blank/null xlsx cell reading back as `''`) turned out
unreachable via the tested construction path — `ExcelJS`'s `row.values`
represents an explicitly-nulled cell as a sparse-array hole, not a `null`
entry, so `Array.prototype.map`'s hole-skipping means the header key ends
up `undefined` rather than exercising the source's `value === null -> ''`
branch; not chased further (may still be reachable via a real hand-authored
`.xlsx` file's genuinely-blank cell — untried). Remaining branch gap (lines
307, 358/406, 366/414, 576, 645-647, 770-772, 824-828, 1009) is mostly
generic per-row/outer try/catch handlers and a `results.errors.push` branch
for an `upsertResult.action === 'skip'` outcome that `upsertPatient` never
actually returns — confirmed dead code, same class as `decorateRecord`
above; **filed as issue #257**.

`src/services/NotificationService.js` worked 2026-07-23 (session 10): extended
`tests/unit/NotificationService.test.js` (+30 tests, 92 total). Covered, all
previously untested/only-mocked-away: `isLoopbackHostname` (exported helper —
case-insensitive `localhost`, `127.0.0.1`, bracketed/unbracketed `::1`,
non-loopback, empty/undefined), `validateFrontendUrl`'s full branch set (the
`!error?.code` wrap-vs-rethrow distinction — a plain code-less throw from
`getFrontendUrl` gets wrapped into `CONSENT_FRONTEND_URL_INVALID`, while
Node's own `new URL()` parse failure carries its own `ERR_INVALID_URL` code
and is rethrown unchanged; remote+loopback-despite-https throw; non-remote
http-on-non-loopback throw; the `isDevelopment`-gated http-loopback allow vs.
deny), `persistConsentDeliveryFailure`'s no-patient-id early return and its
real (unmocked) `connectDB()` rejection path (no MONGO_URI in test env, same
established pattern as the existing `persistComplianceLog` test),
`getNotificationQueue`'s real (unmocked) `initRedis()` failure path (no Redis
env vars in test env — throws, doesn't return null, since `validateRedisOnly`
only returns `false` in `NODE_ENV=development`), a real (unmocked)
`socket.io` `Server` construction in `initSocketIO`'s previously-untested
else-branch, and `notifyJobStarted`/`notifyJobProgress`'s no-io-initialized
guards (only `notifyJobQueued`'s had a test). Moved isolated coverage
89.2/74.54/? -> 91.15/75.9/93.47 (lines/branches/funcs). Remaining branch gap
(lines ~524-525, 802-810) is `getNotificationQueue`'s successful-connection
`new Queue(...)` construction and `sendCriticalTempAlertFromInflux` (needs a
real or injectable Redis/InfluxDB client — same class of accepted gap as
`mqtt-telemetry.service.js`'s `mqtt.connect()` note above, not chased further
this slice).

## Maintaining this file

If `test-loop` finds this file stale (a listed ZERO/LOW file turns out
already well-tested, or vice versa), fix the entry in the same commit —
don't just work around it. If the reconcile cadence above stops making
sense (too frequent/rare), update it and say why in the session's
wrap-up. Detailed per-slice writeups belong in the slice's own commit
message, never back into this file.
