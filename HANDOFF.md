# HANDOFF

**Written:** 2026-08-11, end of session on `feature/docker-e2e-backend-integration`,
after resolving #520 and #521.

## What happened this session

Dennis said "Pick #520 and #521." **Routing:** `work-issue` → `resolve-issue`
for both — #520 is test-tooling config (not product source, so not
`fix-bugs`); #521 was explicitly framed as a design call, the direct
sibling of #519's design question from the prior session.

**#520** (`frontend/vitest.config.js` missing the `@` path alias
`vite.config.js` defines, breaking any vitest run that transitively
imports a `@/...` module): mechanical fix, no design call needed. Added
the same `resolve.alias` to `vitest.config.js`. Added a regression test
(`frontend/tests/unit/viteAliasResolution.test.ts`) and verified it both
reproduces the exact error from the issue *without* the fix and passes
*with* it — not just "looks fixed." **#520 closed.**

**#521** (`sampleMerkleIntegrity.js`'s `clinicalData` still didn't match
`buildClinicalData`'s shape, even after #519's algorithm fix): checked
`docs/architecture/`, `docs/docs-7-27-2026/extracted/` (dict-02/03/07,
requisitos-index), `docs/docs-7-31-2026/` — none settle the question
(the only Merkle-related requirement, RF012, is about audit-event batch
roots, unrelated to this per-sample intake-time preview hash). Genuine
design call, so **asked Dennis via `AskUserQuestion`** with a first framing
that turned out to be based on incomplete research (see "New this
session" below) — corrected and re-asked before implementing.

**Delivered and merged** (branch `fix/521-sample-integrity-clinical-data-parity`,
commit `791230f7`, merged at `6bf225e2`):
- `frontend/src/utils/sampleMerkleIntegrity.js` — added `normalizeClinicalData`
  (mirrors backend `buildClinicalData` field-for-field, accepts both
  camelCase and the wizard's legacy snake_case input keys), called from
  `generateSampleHash` instead of passing `clinicalData` through raw.
  `normalizePharmacologyData` gained the `atcClass`-from-`atcCode` fallback
  (`buildPharmacologyData`'s `atcCode.charAt(0)` behavior) and stopped
  spreading raw input keys into the hashed object (was leaking
  non-canonical snake_case keys into the payload whenever the caller
  supplied them).
- `frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx`'s
  `buildSampleIntegrityInput` now sources `charlsonComorbidities` from the
  same comorbidity-checkbox definitions `buildSubmissionPayload` already
  reads (array of checked slugs), and emits `biomarkerValues` instead of
  `biomarkers_values`.
- 6 new/updated tests in `sampleMerkleIntegrity.test.js` (15 total,
  passing). `npm run typecheck:full` clean (0 errors).
- **#521 closed** against this delivered scope.

**New issue filed — #522** (out-of-scope live bug, found while tracing
#521's data flow): the intake wizard's actual *submission* payload sends
Charlson comorbidity data as `clinical.comorbidities` (a boolean map),
but the backend's `buildClinicalData` reads `clinical.charlsonConditions`
(an array) — a key that's never sent. Every sample created via the
intake wizard today silently gets `charlsonComorbidities: []` regardless
of what the user checked. This is a real, live bug (unlike #521, which
was a client-side-only preview hash with zero comparison callers) — not
fixed here since it's a different function (`buildSubmissionPayload`,
not `buildSampleIntegrityInput`). Open, no design call needed — the fix
shape (align both sides on the array-of-codes shape, since the backend,
its tests, and `frontend/src/types/models.ts` all already agree on that
shape) is reasonably clear.

**Skills-pack issue filed — [dyeallpies-skills-pack#234](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/234)**:
`resolve-issue`'s design-call section has a docs-thoroughness rule but no
equivalent for code-capability-existence claims. My first pass at #521
told Dennis "formData has no Charlson field at all" based on one
literal-string grep for "charlson" — wrong; the wizard already had a
full Charlson checkbox UI under a different field name
(`clinicalComorbidityDefinitions`/`comorbidities`), which a broader
data-flow trace would have found. Cost a second `AskUserQuestion`
round-trip. Suggested fix filed against the pack, not edited directly
(consuming-project session, Rule 0).

**No security-relevant findings** this session — #522 is silent data
loss on a clinical field, not a trust-boundary issue (reasoned about
explicitly in the issue body).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `6bf225e2`, clean, up
  to date with origin. Contains the merges of #520's fix (`51419e39`) and
  #521's fix (`791230f7`).
- No dangling branches from this session — both
  `fix/520-vitest-path-alias` and
  `fix/521-sample-integrity-clinical-data-parity` deleted locally and
  remotely after clean merges.
- Issues this session: **#520 closed**, **#521 closed** (both delivered
  scope, merged at `6bf225e2`). **#522 filed** (new, open — Charlson
  comorbidity data-loss bug in the real submission path).
  **dyeallpies-skills-pack#234 filed** (new, open — pack-repo finding).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (unchanged from prior handoff except #520/#521's
removal and #522's addition):

**#522** — new this session, see above. No design call needed; the fix
shape is clear (align `buildSubmissionPayload`'s comorbidities output
with what `buildClinicalData` reads), just needs picking up. Live bug,
not cosmetic like #519/#521 were — probably worth prioritizing over the
older backlog below.

**skills-pack#233** — pack-repo only, low priority: fix the
BioAvanceD-v2 overlay's per-iteration typecheck guidance
(`npm --prefix frontend run typecheck` resolves to `typecheck:core`,
which silently checks almost nothing) to point at `typecheck:full`
instead.

**skills-pack#234** — new this session, pack-repo only: add a
data-flow-tracing rule to `resolve-issue`'s design-call section
alongside the existing docs-enumeration rule.

**#504** — the sealed-snapshot backfill script exists and is
unit-tested, but has not been *run* against any live environment.
Whoever next stands up a real Mongo instance with pre-#502 sample data
should run `node src/scripts/backfillSealedSnapshotPins.js` once
(idempotent, safe to re-run).

**#390** — umbrella issue; #491/#493/#494/#495 all closed, #517/#518/#519
are done, #521 (this session) is now also done. Worth a fresh look at
whether #390 itself should close or get a status comment.

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

## Dev stack state

Nothing started this session. All verification ran targeted
`npx vitest run` on the specific touched test files (plus one manual
alias-removal/restore cycle to prove #520's regression test actually
catches the bug) and `npm run typecheck:full` (0 errors) from
`frontend/` — no Docker, no live app, no full suite.

## Which skills to use

- `work-issue` → `resolve-issue`: same routing pattern as last session —
  test-tooling config (#520) isn't `fix-bugs`' product-source territory;
  a design-call-labeled issue (#521) still needs the docs-thoroughness
  check before escalating to Dennis, even when a prior session already
  established the pattern for its sibling issue (#519).
- **New this session:** when tracing a design call's cost/scope to
  present options to the user, a single literal-string grep for the
  domain term ("charlson") is not enough to claim a capability "doesn't
  exist" — field/dictionary names in this codebase don't always match
  the domain term an issue uses. Trace the actual data pipeline (form
  state → submission payload → backend field) before asserting absence.
  Filed as dyeallpies-skills-pack#234 since it's a `resolve-issue`
  gap, not a BioAvanceD-v2-specific one.
- **New this session:** the wrong-absence-claim above also surfaced a
  real, separate live bug (#522) purely as a side effect of tracing the
  data flow to correct the mistake — reinforces that the broader trace
  is worth doing even when the narrower grep would have "worked" for
  the immediate question.
