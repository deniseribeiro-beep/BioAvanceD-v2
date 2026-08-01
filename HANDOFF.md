# HANDOFF

**Written:** 2026-08-01, after closing #376 (stale `patientName` assertion,
`fix-bugs`) on `feature/docker-e2e-backend-integration`.

## What happened this session

Picked up via `work-issue` (no specific issue named — routed off the open
backlog). Three `bug`-labeled candidates: #376 (patients API missing
`patientName`, pinned test, clear repro), #375 (`test:architecture` can't
parse ESM under `node --test`, CI-blocking but not reachable until the next
`ship-integration-branch` pass), #369 (audit-logger canonicalization
flooding logs, unpinned, needs open-ended investigation). Chose **#376**:
strongest fit for fix-bugs' picking rules (pinned assertion, user-facing
correctness, isolated repro) over #375 (not yet reachable) and #369
(cosmetic/logging, no pinned test).

**Root cause: stale test, not a product bug.** Traced
`patients.expanded.api.test.js`'s failing assertion
(`expect(response.body.data.patientName).toBeDefined()`) back through
`paciente.controller.js#buscar` and found the field is deliberately
stripped as of **#363** (RF005/RNF007 ParticipantIdentity segregation,
`8ab1cf72`, my own prior session) — documented in
`docs/architecture/canonical-data-contract-v1.md` ("Landed in #363":
`patientName`/`birthDate`/`identityDocument` no longer returned on the
participant resource, for any caller). `patients.expanded.api.test.js`
predates that commit and was never updated when the behavior changed —
the exact "stale-test issue" shape from `fix-bugs`' picking guide, not a
regression. Fix: flip the assertion to `toBeUndefined()`, matching the
sibling `intake-wizard.spec.ts` idiom that #363 itself used. No product
code touched.

**Landed** (`fix/376-stale-patientname-assertion`, merged into
`feature/docker-e2e-backend-integration` at `73658c25`):

- `api/backend/tests/integration/patients.expanded.api.test.js`: one
  assertion flipped + a comment citing #363.
- Verified: `patients.expanded.api.test.js` (24/24),
  `tests/unit/paciente.controller.test.js` (66/66),
  `tests/unit/patient-identity.service.test.js` (7/7) — all green, both
  pre- and post-merge.

**Issue #376 closed**, comment notes the trace and commit hash. Fix branch
deleted (local + remote).

**Friction filed:** `dyeallpies-skills-pack#180` — mid-iteration I ran
`npx vitest run tests/unit tests/integration` intending fix-bugs' "cast a
slightly wider net" verification step; this is effectively the whole
native suite, but `full-suite-guard.cjs` didn't block it because its
bare-invocation matcher exempts any run with explicit directory targets
(designed for the periodic coverage-reconcile step, doesn't distinguish
that caller from a loop's mid-iteration guess). Caught it myself before
reading the output (stopped the backgrounded run, reran scoped to the
three actual files above) — no bad verification result was used, but
filed since the gap could recur. Not something I could fix directly
(pack files aren't editable from a consuming-project session per
`skill-maintenance` Rule 0).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `73658c25`, **in sync
  with origin** (nothing outstanding to push). Working tree clean except
  the pre-existing `catalog.1.3.0.json` phantom line-ending diff (#391 —
  confirmed no-op again this session, still open/unfixed).
- Issues: **#376 closed** (`73658c25` noted in the close comment).
  **dyeallpies-skills-pack#180 opened** (skills-pack repo, open — not a
  BioAvanceD-v2 issue, don't look for it in this repo's tracker).
- `fix/376-stale-patientname-assertion` (merged) deleted, local + remote.
- Local branch hygiene: swept all local branches against the integration
  branch this session — everything merged except
  `test/377-docs-on-main`, which is genuinely dangling but *tracked*
  (holds Denise's 7-31 Modelagem docs drop, referenced by still-open
  **#379**'s "supersede the CMPB submission copies" decision) — not lost
  work, no action needed.
- Untouched from before: **#389** (storage/custody separation, open),
  **#390** (multi-consumer migration, open, depends on #383+#388+#389),
  **#391** (`.gitattributes` phantom-diff fix, open, small/mechanical),
  **#392** (dict-02's fuller SpecimenPreanalytics fields, open,
  build-loop sized), **#375** (CI-blocking `test:architecture` ESM
  parse failure — not yet reachable until the next `ship-integration-branch`
  pass, but worth fixing before then), **#369** (audit-logger log-flood,
  needs investigation before it's fixable).

## Blocking next step

None. Nothing queued as blocking.

No next issue queued explicitly by Dennis. #375 is the natural
bug-backlog continuation (same discovery session as #376, same
`fix-bugs` shape, and its "will fail on the first PR to main" framing
means it's worth fixing before `ship-integration-branch` rather than
after) — but that's an inference from this session's own picking
process, not something Dennis said.

## Which skills to use

- **#375** (`test:architecture` ESM/CommonJS mismatch): `fix-bugs`. Two
  documented candidate fixes in the issue body itself (rewrite arch tests
  to `require()`, or drop the separate `test:architecture` script and
  rely on `test:unit:vitest`) — pick one, re-verify `current-state:ci`
  end to end per the issue's own note, not just the isolated script.
- **#369** (audit-logger log flood): `fix-bugs`, but budget time for
  investigation first — no pinned test, root cause/call site not yet
  identified. Per fix-bugs' picking rules, weigh whether it's actually
  worth an iteration before committing to it (cosmetic/logging, not
  user-facing correctness) vs. #375/#391 which are more clear-cut.
- **#391** (`.gitattributes`): small, mechanical `resolve-issue` — add a
  line-ending rule, renormalize, done in one sitting.
- **#389** (storage/custody entity): scope with `divide-and-conquer`
  first — don't attempt as one slice (28 files, already half-separated
  via `storageBoxes`). Check dict-02's "Entidade" column for the
  canonical name before naming anything (dyeallpies-skills-pack#179).
- **#390**: blocked on #389.
- **#392**: `build-loop`, needs new parsing logic, not just a wrapper.
- Backlog unchanged otherwise from prior handoffs: **#384–#387** (four
  architecture-gap issues), older backlog (`#371`/`#373`/`#374`/`#378`/
  `#379`) — untouched this session.
