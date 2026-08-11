# HANDOFF

**Written:** 2026-08-11, end of session on `feature/docker-e2e-backend-integration`,
after resolving #496.

## What happened this session

Dennis said "Read handoff" (summarized the prior session's state), then
**"Pick #496"**.

`work-issue` routed #496 to **`resolve-issue`** (route 6, the default):
the issue was labeled `enhancement` only, and its body explicitly asked
for a per-file audit — check whether each of 14 named files still reads
`Sample`'s embedded RCS/SPREC/storage-custody fields directly or is
already covered by #491-#495, closing duplicates as already-covered
rather than doing redundant work. That's board-hygiene/audit work, not
a defect, coverage gap, or unbuilt capability.

**#496 resolved this session** (`test/496-canonical-contract-legacy-audit`,
merge commit `4c6796b5`, fix commit `9e64b954`). Audited all 14 files
against current code and #491/#493/#494's own (already-closed) consumer
lists:

- **Confirmed clean, no migration needed:** `sample.routes.js` (fully
  migrated onto `MongoStorageRepository`/`specimenPreanalyticsService`
  per #517), `analysisValidation.service.js` (uses the canonical
  `SampleModel.resolveSpecimenStatus` accessor), `consent.validator.js`,
  `hl7.service.js`, `sampleComplianceSync.service.js`,
  `fhir-validator.service.js`, `fhir.service.js` — all touch only
  already-canonical fields.
- **Already tracked elsewhere:** `intakeWizard.routes.js` (storage/status
  fields — already in #494's own consumer scope), `import.controller.js`
  (its direct RCS/SPREC writes are moot pending #336's still-open "is
  this endpoint dead code" question — no new issue filed for it).
- **Newly found, missed by #491/#493/#494's original audit — filed as
  #525:** `label.routes.js` (direct `sample.sprec`/`sample.locationID`
  reads), `reports.routes.js` (queries `sprec.*`/`final_grade` directly
  as Mongo filter keys), `api/backend/scripts/neo4j-canonical-rebuild.js`
  (reads `sample.rcsScore` directly — the actual outstanding "neo4j
  canonical projection" consumer the doc's own prose anticipated;
  `neo4jCanonicalProjection.service.js`, the *live* service, was
  confirmed clean), `batch-validation-engine.service.js` (legacy
  `locationID` column mapping).
- **Newly found, a genuine missing-wiring gap (not just a legacy read) —
  filed as #526:** `fhir-import-staging.service.js`'s staged-sample
  commit path (`~lines 894-954`) is a fifth live sample-creation path
  that writes `sprec`/`rcs_score`/`final_grade`/... straight onto the new
  `samples` document but never calls `rcsAssessmentService.recordAssessment`/
  `specimenPreanalyticsService.recordProfile` or pins
  `sealedRcsAssessmentId`/`sealedSpecimenPreanalyticsId` — the same gap
  #492/#502/#503/#505/#524 already closed for the other four creation
  paths (`sample.service.js`, `import.service.js`,
  `import-lgpd.service.js`, `intakeWizard.js`).

Recorded all of the above as dated `#496` notes directly in
`docs/architecture/canonical-data-contract-v1.md`'s `RcsAssessment`,
`SpecimenPreanalytics`, and `Known Residual Legacy Surfaces` sections
(the last one explicitly marked as historical/stale, superseded by
#496's own corrected 14-file list). Closed #496 with a summary comment
listing every file's disposition and both new issue numbers.

**No product code changed this session** — doc-only, so no test suite
was run (nothing to run against).

**One workflow-tooling finding, filed against the skills-pack repo (not
this one):** `$TMPDIR` is unset in this machine's Bash-tool Git Bash
session — a heredoc write to `"$TMPDIR/foo.md"` silently collapsed to
an MSYS-root-relative path and failed with a misleading "permission
denied" / "file not found" pair, costing one wasted call before the
cause was clear. Filed as `DyeAllPies/dyeallpies-skills-pack#237`
(worked around by using the Write tool with the session's actual
scratchpad path instead — same fix shape `dennis-windows`'s existing
`mktemp`/tmp-path entries already prescribe, just not yet documented for
the `$TMPDIR` case specifically). Could not edit `dennis-windows`
directly per Rule 0 (only editable from a session in the pack repo
itself).

**No security-relevant findings this session** — pure doc audit, no code
or auth surface touched.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `4c6796b5`, clean, up
  to date with origin. Contains the merge of #496's doc update.
- No dangling branches from this session's own work
  (`test/496-canonical-contract-legacy-audit` deleted locally post-merge;
  never pushed on its own).
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
- Issues this session: **#496 closed** (audited, doc updated, merged at
  `4c6796b5`). **#525 opened** (4 missed RCS/SPREC/storage-custody
  consumers: `label.routes.js`, `reports.routes.js`,
  `neo4j-canonical-rebuild.js`, `batch-validation-engine.service.js`).
  **#526 opened** (`fhir-import-staging.service.js`'s commit path missing
  RcsAssessment/SpecimenPreanalytics wiring — same shape as #524, a real
  build-loop candidate). **skills-pack#237 opened** against
  `DyeAllPies/dyeallpies-skills-pack` (the `$TMPDIR` tooling finding
  above — not a BioAvanceD-v2 issue).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per this
skill's "only if the user explicitly said so" rule, nothing is queued.

Candidates carried forward from the prior handoff, plus this session's
two new issues:

- **#526** — `fhir-import-staging.service.js` missing RcsAssessment/
  SpecimenPreanalytics wiring on staged-sample commit. Freshest, most
  concretely scoped (mirrors #524 almost exactly) — likely routes to
  `build-loop` the same way #524 did.
- **#525** — 4 additional RCS/SPREC/storage-custody consumers found by
  #496's re-audit. Likely routes to `resolve-issue`/a small migration
  slice per file, same shape as #491/#493/#494.
- **#390** — umbrella; all originally-tracked sub-issues closed, plus
  #496 (audit) now also closed. Still not re-assessed whether it should
  close or get a status comment — carrying forward again, now with two
  fresh children (#525/#526) that may want to hang off it too.
- **#489** — full-suite vitest flakiness, open, not re-confirmed.
- **#386** — RBAC still keyed on `accessType`/`roleName` per dict-07,
  open, not re-triaged this session.
- **#336** — still open: is `import.controller.js#importFhirBundle`
  (the synchronous "mantido para compatibilidade" FHIR import endpoint)
  dead code to remove, or does something still call it? #496's audit
  found it also writes legacy RCS/SPREC fields directly, but didn't
  investigate the dead-code question itself — that's still #336's job.
- Older backlog, unchanged: `#371`/`#373`/`#374`/`#378`/`#379`, `#368`,
  next e2e slice per `E2E_TRACEABILITY_PLAN.md`/`#331`.
- **skills-pack#233/#234/#235/#236/#237** — pack-repo only, low
  priority, unchanged (plus this session's new #237).

## Dev stack state

Nothing started this session. Doc-only change (audit + `.md` edits) —
no code touched, so no native/Docker verification was applicable.

## Which skills to use

- `work-issue` → `resolve-issue` (route 6) is the right route for a
  labeled-`enhancement`, audit-shaped issue with no bug/test/build
  signal — worked cleanly, no misroute.
- `gh issue list --search "<keyword>" --state all` before filing any new
  issue paid off twice this session: found `#336` already covering
  `import.controller.js`'s dead-code question (avoided a duplicate
  migration issue for it) and confirmed no prior issue existed for the
  `fhir-import-staging.service.js` gap or the four #525 files before
  filing.
- Confirmed again: a fix/audit branch only merged locally (never pushed
  on its own) needs no remote branch-delete step — same pattern prior
  handoffs already tracked.
- New this session: `$TMPDIR` is unset in this machine's Bash-tool Git
  Bash session — don't use it in heredocs; use the session scratchpad
  path directly instead (see `skills-pack#237` above, and `dennis-windows`
  once that issue lands there).
