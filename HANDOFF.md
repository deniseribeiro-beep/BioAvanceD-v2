# HANDOFF

**Written:** 2026-08-11, end of session on `feature/docker-e2e-backend-integration`,
after resolving #522.

## What happened this session

Dennis said "Read handoff and resolve issue 522." **Routing:**
`work-issue` → `fix-bugs` — #522 was a reproducible product defect
(silent data loss on a real submission path), not test-tooling or a
coverage gap.

**#522** (intake wizard's `buildSubmissionPayload` sent Charlson
comorbidity data as `clinical.comorbidities` — a boolean map — but the
backend's `buildClinicalData` reads `clinical.charlsonConditions` — an
array — a key that was never sent, so every sample created via the
intake wizard silently got `charlsonComorbidities: []` regardless of
what the user checked):

**Delivered and merged** (branch `fix/522-charlson-comorbidity-submission-shape`,
commit `348d4050`, merged at `c20ea674`):
- `frontend/src/components/v2/intake/ClinicalIntakeWizard.jsx` —
  extracted `buildCharlsonConditions` (the array-of-checked-slugs
  computation #521's `buildSampleIntegrityInput` already used) and had
  `buildSubmissionPayload` call it too, replacing the boolean-map
  `comorbidities` field with `charlsonConditions`.
- `api/backend/src/contracts/canonical/v1/index.js` — the
  `canonical.v1.intake` schema's `clinical` sub-schema has
  `additionalProperties: false`, so sending the new field name without
  updating the schema would have gotten every submission **rejected
  with a 422** instead of silently losing data — changed
  `comorbidities: { type: 'object' }` to
  `charlsonConditions: { type: 'array' }`.
- `frontend/src/api/intake.service.js` — fixed the same stale key in
  `registerClinicalIntake`'s fallback default object (dead in practice
  today since the wizard always populates `clinical`, but same
  field-name bug family, one-line fix).
- New regression test in `ClinicalIntakeWizard.test.jsx` (#522) pinning
  the correct array shape; existing backend test
  (`intakeWizard.helpers.test.js`) already asserted the correct
  read-side shape, so no backend test needed updating.
- Verified on the merged tree: 17/17 frontend tests
  (`ClinicalIntakeWizard.test.jsx` + `sampleMerkleIntegrity.test.js`),
  63/63 backend tests (intakeWizard routes/governance/contract/helpers),
  `npm run typecheck:full` clean.
- **#522 closed** against this delivered scope.

**Pre-existing failures noted, not caused by this fix:** 4 tests in
`api/backend/tests/unit/import-lgpd.service.importSamples.unit.test.js`
(`boxId auto-assignment (#459)` describe block) fail on the unmodified
tree too (confirmed via `git stash` before committing) — unrelated to
comorbidities/#522, not touched this session.

**Skills-pack issue filed —
[dyeallpies-skills-pack#235](https://github.com/DyeAllPies/dyeallpies-skills-pack/issues/235)**:
`push-wrapup-checkpoint.cjs`'s "gh issue comment = completion signal"
heuristic (added by pack#203 to fix a *different* misfire in
`divide-and-conquer`'s multi-issue filing playbook) fired immediately
after `fix-bugs`' step-1 "Fixed at \<hash\>" issue comment this session —
three steps before the iteration actually ends (merge, close, wrap-up
still pending). Harmless this time (I deferred the actual wrap-up
invocation to the true end; the second firing on `gh issue close` was
suppressed by the 10-minute dedup window), but the reminder's "NOW"
phrasing reads as literal and could mislead a session into drafting its
summary before merging/closing. Suggested fix directions filed against
the pack, not edited directly (consuming-project session, Rule 0).

**No security-relevant findings** this session — #522 is silent data
loss on a clinical field via a field-name mismatch, not a trust-boundary
issue; the schema change tightens validation (adds the correct field
name) rather than relaxing it.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `c20ea674`, clean, up
  to date with origin. Contains the merge of #522's fix (`348d4050`).
- No dangling branches from this session — `fix/522-charlson-comorbidity-submission-shape`
  deleted locally and remotely after a clean merge.
- Issues this session: **#522 closed** (delivered scope, merged at
  `c20ea674`). **dyeallpies-skills-pack#235 filed** (new, open —
  pack-repo hook-timing finding).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (unchanged from prior handoff except #522's
removal):

**skills-pack#233** — pack-repo only, low priority: fix the
BioAvanceD-v2 overlay's per-iteration typecheck guidance
(`npm --prefix frontend run typecheck` resolves to `typecheck:core`,
which silently checks almost nothing) to point at `typecheck:full`
instead.

**skills-pack#234** — pack-repo only: add a data-flow-tracing rule to
`resolve-issue`'s design-call section alongside the existing
docs-enumeration rule.

**skills-pack#235** — new this session, pack-repo only: reconcile
`push-wrapup-checkpoint.cjs`'s comment-as-completion-signal heuristic
with `fix-bugs`' comment-first ending sequence.

**#504** — the sealed-snapshot backfill script exists and is
unit-tested, but has not been *run* against any live environment.
Whoever next stands up a real Mongo instance with pre-#502 sample data
should run `node src/scripts/backfillSealedSnapshotPins.js` once
(idempotent, safe to re-run).

**#390** — umbrella issue; #491/#493/#494/#495/#517/#518/#519/#521 are
all done. Worth a fresh look at whether #390 itself should close or get
a status comment.

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
- **Pre-existing test failures noted but not fixed this session:** 4
  tests in
  `api/backend/tests/unit/import-lgpd.service.importSamples.unit.test.js`
  (`boxId auto-assignment (#459)` describe block) — confirmed failing on
  the unmodified tree, unrelated to #522. No issue filed yet for this
  specifically; worth checking whether #459 or a fresh issue already
  covers it before the next session touches that file.
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
`npx vitest run` on specific touched/related test files (frontend and
backend) plus `npm run typecheck:full` (0 errors) from `frontend/` — no
Docker, no live app, no full suite. One `git stash`/`stash pop` cycle
was used to confirm 4 pre-existing test failures predate this session's
changes (see above); working tree was restored cleanly afterward.

## Which skills to use

- `work-issue` → `fix-bugs`: straightforward routing — #522 was a
  reproducible product defect with a clear fix shape already sketched in
  the issue body (#521's own handoff), so `resolve-issue`'s
  deferral-evaluation machinery wasn't needed.
- **New this session:** before changing a payload field name that
  crosses a schema boundary with `additionalProperties: false` (this
  repo's `canonical.v1.intake` contract, `api/backend/src/contracts/canonical/v1/index.js`),
  check whether the schema needs the same rename — otherwise the fix
  trades silent data loss for a hard 422 on every submission, which is
  worse. Caught by tracing `validate('canonical.v1.intake', data)`'s
  call site before assuming the field-name fix was complete.
- **New this session:** `push-wrapup-checkpoint.cjs` can fire on
  `fix-bugs`' intermediate "Fixed at \<hash\>" issue comment (step 1 of
  4), not just at the true end of the iteration — see
  dyeallpies-skills-pack#235. If the reminder fires there, the merge and
  close steps still need to happen before actually invoking `wrap-up`
  and drafting the summary; don't treat the reminder's "NOW" as license
  to skip ahead.
