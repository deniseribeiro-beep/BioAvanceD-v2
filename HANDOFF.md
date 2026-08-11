# HANDOFF

**Written:** 2026-08-11, end of session on `feature/docker-e2e-backend-integration`,
after resolving #519.

## What happened this session

Dennis said "Pick #519" (`sampleMerkleIntegrity.js` computing a
structurally different Merkle root than the backend's `MerkleService`).
**Routing:** `work-issue` → `resolve-issue` (bug-labeled, but the issue's
own body flagged it as currently dead/orphaned code needing a design
call, not a reproducible live bug — so not `fix-bugs`).

Per `resolve-issue`'s "needs a design call" trigger, checked `docs/`
(canonical-data-contract-v1.md, canonical-active-surface.md, dict-02)
before treating the design call as still open — found nothing that
settles which Merkle shape (3-leaf tree vs. flat hash) was intended;
dict-02's `MerkleRoot` entity (P1X-0162..0167) is an unrelated
"audit-batch root" governance concept, not this per-sample hash. So the
design call was genuine, not stale. Read both implementations in full
(`frontend/src/utils/sampleMerkleIntegrity.js`,
`api/backend/src/services/MerkleService.js`) and confirmed the issue's
claim exactly: frontend built a real 3-leaf tree over snake_case
intake-wizard field names; backend computes one flat SHA-256 over a
differently-shaped camelCase object. No field-mapping fix could make
these agree.

**Asked Dennis via AskUserQuestion** which resolution he wanted (delete
the dead code / rewrite frontend to mirror backend / leave as-is with a
comment). **Dennis chose: rewrite frontend to mirror backend.**

**Delivered and merged** (branch `fix/519-sample-merkle-integrity-algorithm`,
commit `5dbb9ab5`, merged into `feature/docker-e2e-backend-integration`
at `e14fda88`):

- `frontend/src/utils/sampleMerkleIntegrity.js` — fully rewritten to
  compute the same single flat SHA-256 as
  `MerkleService.generateSampleHash` (ported `deepSort`/`stableSerialize`/
  `normalizeParticipantIdentity`/`normalizePharmacologyData` field-for-field),
  using `crypto.subtle` (WebCrypto) instead of Node's `crypto` module.
  `buildSampleMerkleRoot`/`verifySampleIntegrity` kept their names/call
  shape (`{ rootHash }`) so the only caller didn't need restructuring.
- `frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx`'s
  `buildSampleIntegrityInput` updated to feed the new field shape
  (`participant_identity`/`clinicalData`/`sprec`/`pharmacologyData` instead
  of the old `patient_identity`/`clinical_data`/`pharmacology_data`
  3-leaf-tree keys).
- Tests: new `sampleMerkleIntegrity.test.js` (12 tests), including a
  cross-check against Node's `crypto.createHash` for the same canonical
  payload string, confirming WebCrypto/Node SHA-256 parity — not just
  "looks similar," an actual byte-for-byte proof. `npm run typecheck:full`
  clean (0 errors) on the merged branch.
- **#519 closed** against this delivered scope.

**New issue filed — #521** (out-of-scope finding from verifying the fix
actually mattered): even with #519's algorithm-shape fix, the frontend's
computed hash still won't equal the backend's persisted hash for the
same sample, because `buildSampleIntegrityInput`'s `clinicalData`
mapping still uses `biomarkers_values` (snake_case, no
`charlsonComorbidities`) while server-side `buildClinicalData`
(`api/backend/src/routes/intakeWizard.js:107-118`) produces
`biomarkerValues` (camelCase) plus `charlsonComorbidities`; also
`pharmacologyData`'s `atcLevel1` fallback logic isn't replicated
client-side. Not a live bug today (server always overwrites the
frontend-submitted value, nothing compares them yet) — a latent gap for
whoever eventually wires up client-side verification. Needs its own
design call on whether `buildSampleIntegrityInput` should track
`buildClinicalData`'s exact shape.

**No security-relevant findings** — this touches unused/dead
integrity-check code, not a live trust boundary.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `e14fda88`, clean, up
  to date with origin. Contains the merge of #519's fix (`5dbb9ab5`).
- No dangling branches from this session —
  `fix/519-sample-merkle-integrity-algorithm` deleted both locally and
  remotely after a clean merge.
- Issues this session: **#519 closed** (delivered scope, merged at
  `e14fda88`). **#521 filed** (new, open — clinicalData field-shape
  residual gap, see above).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (unchanged from prior handoff except #519's
removal and #521's addition):

**#521** — new this session, see above. Needs a design call (does
`buildSampleIntegrityInput`'s `clinicalData` need to track
`buildClinicalData`'s exact shape, or is the variance acceptable?)
before any code change — same "check docs first, then ask Dennis if
docs don't settle it" pattern #519 used, since this is the direct
sibling of that same design question.

**#520** — `frontend/vitest.config.js` missing the `@` path alias
`vite.config.js` defines. Small, mechanical fix (`resolve.alias` or
`mergeConfig`), no design call needed.

**skills-pack#233** — pack-repo only, low priority: fix the
BioAvanceD-v2 overlay's per-iteration typecheck guidance
(`npm --prefix frontend run typecheck` resolves to `typecheck:core`,
which silently checks almost nothing) to point at `typecheck:full`
instead.

**#504** — the sealed-snapshot backfill script exists and is
unit-tested, but has not been *run* against any live environment.
Whoever next stands up a real Mongo instance with pre-#502 sample data
should run `node src/scripts/backfillSealedSnapshotPins.js` once
(idempotent, safe to re-run).

**#390** — umbrella issue; #491/#493/#494/#495 all closed, both #517 and
#518 (the #495 split-out remainder) are done, and #519 (found while
investigating #495) is now also done. Worth a fresh look at whether #390
itself should close or get a status comment.

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

Nothing started this session. All verification ran targeted `npx vitest
run src/utils/sampleMerkleIntegrity.test.js` plus `npm run
typecheck:full` (0 errors) from `frontend/` — no Docker, no live app, no
full suite.

## Which skills to use

- `work-issue` → `resolve-issue`: #519 was `bug`-labeled but its own body
  named it dead/orphaned code needing a design call — verified the docs
  didn't already settle the call before escalating to Dennis via
  `AskUserQuestion`, rather than either assuming the label or silently
  guessing an answer.
- **New this session:** when a design call genuinely can't be resolved
  from docs, `AskUserQuestion` with concrete options (not an open-ended
  "what should I do?") got a fast, unambiguous answer — worth the pause
  rather than picking a default and hoping.
- **New this session:** when a fix is scoped as "mirror algorithm X,"
  verify it actually would work end-to-end (traced what data the
  algorithm would receive on both sides) rather than stopping at
  "the hash functions now have the same shape." That check is what
  surfaced #521 — the mirrored algorithm still receives differently-shaped
  input data on each side, which a shallower verification would have
  missed entirely.
