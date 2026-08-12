# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after closing #548 (Dennis said "Read handoff and pick issue 373").

## What happened this session

Read the prior HANDOFF.md (which had #390 fully resolved and nothing
queued for next). Dennis asked to pick up #373, which was already on
the prior handoff's older-backlog candidates list.

#373 ("Expand RF028 to the remaining 13 Fase 2 sources + full AC7
lifecycle + Neo4j outbox projection") is a follow-up to #367 (HPO, the
first Fase 2 reference-data source). Its own body recommended
`divide-and-conquer` and named a reasonable next landable chunk: one
more source (MONDO) proven end-to-end the same way HPO was. Routed via
`work-issue` → `divide-and-conquer`, confirmed the 5-issue split with
Dennis before filing, then filed:

- **#548** — Add MONDO as the second Fase 2 source (the recommended
  next chunk). **Built and closed this session** (see below).
- **#549** — Add the remaining 12 sources (ORPHA, CID-11, CID-10, OMIM,
  HGNC, LOINC, UCUM, ATC, DCB, DUO, Uberon, NCBI Taxonomy, EDAM).
  Depends on #548. **Corrected mid-session**: #373's own source list
  (copied into #549's title/body) omitted **Cell Ontology** — caught by
  checking `Plano_Integrado_Foundation_Data_Pipeline.md` §7.4 step 8
  directly before starting #548 (build-loop's "grep the primary doc"
  rule). #549 now correctly scopes 13 remaining sources, not 12; see the
  correction comment on the issue.
- **#550** — Live download + real license verification for all 14
  sources, including the no-live-network-in-scripts design question.
- **#551** — Full AC7 lifecycle: checkpoint/resume, quarantine recovery
  (`resolutionStatus` transitions), rollback.
- **#552** — Neo4j outbox projection (AC9) for
  `TerminologyConcept`/`TerminologyRelation`.

#373 stays open as the tracking issue (comment lists all five, same
shape as #390's tree).

**#548 (MONDO source) was then built and shipped this session**, via
`build-loop`. Mirrors HPO's exact shape from #367:

- `api/backend/src/reference-data/reference-imports/sources/mondo.js` +
  `normalizeMondo.js` — MONDO graduated to its own operational importer,
  same pattern as HPO (bundled fixture, not live download — that's
  #550's scope). License is fixed (`CC BY 4.0` per
  `dict-01_FONTES.md`'s `SRC_MONDO` row), unlike HPO's
  pending-verification placeholder.
- `fixtures/mondo-sample.jsonl` — 8 valid + 2 intentionally-invalid
  records (missing code/label), same shape as `hpo-sample.jsonl`.
  Disease codes/labels are a small illustrative sample, not asserted as
  a verified snapshot of a specific official MONDO release (see the
  file's own header comment).
- `scripts/reference-imports/import-mondo-reference-dataset.js` +
  `reference:import:mondo`/`:dry-run` npm scripts +
  `reference-data-bootstrap-mondo` compose.dev.yml service (depends on
  `reference-data-bootstrap` completing, matching §7.4's documented
  order).
- `import-large-reference-dataset.js`'s placeholder scaffold no longer
  lists `mondo` in its allowed-datasets set (graduated, same as HPO).
- `reference-import-boundary.arch.test.js` extended with MONDO-mirror
  assertions (fixture-only, no live network, excluded from the
  placeholder scaffold).
- `normalizeMondo.test.js` — 6 unit tests, mirroring
  `normalizeHpo.test.js`.
- `pipeline-continuity.spec.ts`'s RF028 describe block got a new
  MONDO-specific assertion (queries `referenceDatasetReleases`/
  `terminologyConcepts` filtered by `datasetCode`/`systemUri`, so it
  can't pass on HPO's data alone) + two new `queryFoundationData.ts`
  helpers backing it.

Verified: 29/29 targeted unit tests, 11/11 architecture tests natively;
then (per build-loop's Docker-on-by-default rule for this loop) brought
up the real dev stack (`compose.yml`+`compose.dev.yml`) and confirmed
`reference-data-bootstrap-mondo` actually ran — 10 records read, 8
validated, 2 rejected, 15 inserted (8 concepts + 7 `is_a` relations) —
then ran the actual Playwright spec
(`pipeline-continuity.spec.ts -g "Reference data importers"`) against
that stack: all 3 tests pass, including the new MONDO-specific one.

Committed on `test/548-mondo-reference-source`, merged (no-ff) into
`feature/docker-e2e-backend-integration` at `3fe8fefc`, pushed, #548
closed with the merge hash and verification summary, local branch
deleted.

`wrap-up`'s core + shipping audits found two pieces of real friction,
both filed (not left as chat-only notes):

- **skills-pack#250**: `session-cleanup-checkpoint.cjs` (the Stop hook
  backing `clean-up`) fired mid-task, while a `docker compose up
  --build` was still running in the background and the assistant had
  legitimately paused the turn to await its completion notification —
  the hook has no signal to distinguish that from the session actually
  ending. Worked around by explaining and continuing to wait; filed so
  a future pack session can add a "pending background task" check.
- **skills-pack#251**: `docker-workflow`'s BioAvanceD-v2 overlay is
  missing a gotcha — a full-stack `docker compose up -d --build` can
  return (exit 0) with later one-shot chain services
  (`reference-data-bootstrap` → `reference-data-bootstrap-mondo`) still
  in `Created` state, never run; and a plain retry can fail outright on
  an unrelated `frontend` port-5173 bind error. Fix (targeting the
  specific chain services directly) is documented in the issue body,
  verbatim, ready for a pack-repo session to apply — Rule 0 blocked
  editing the overlay directly through the junction from this project.

No lazy fixes, no scope creep outside #548's files, no unresolved
"needs owner call" labels closed without a matching open issue. Nothing
security/safety-relevant touched (dev-stack-only credentials already
in the gitignored `.env.docker`, same pattern prior sessions used).

**Security/safety note:** none. Product change is a data-import source
addition with a real-backend proof; no new routes, no auth changes, no
secrets introduced.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `3fe8fefc`, clean,
  pushed, up to date with origin. Carries #548's MONDO source on top of
  everything from prior sessions.
- Issues this session: **#548 closed** (built + merged + verified).
  **#373 stays open** as the tracking issue for the RF028 expansion
  (comment lists #548/#549/#550/#551/#552). **#549/#550/#551/#552
  filed, open, not yet started.**
- Docker: dev stack (`compose.yml`+`compose.dev.yml`) was brought up
  this session to verify #548, then torn down at session end
  (`docker compose down`, no `-v` — named volumes/data untouched) per
  Dennis's explicit confirmation. Session-built images
  (`bioavanced-backend`, `bioavanced-frontend`,
  `bioavanced-reference-data-bootstrap-mondo`, etc., ~4.4GB total) were
  **deliberately left cached**, not pruned — build cache itself was
  negligible (12MB, nothing worth pruning), and these are the project's
  real dev-stack images (not disposable test tags) that #549's very
  likely next session will need again immediately; forcing a full
  ~8-10 minute rebuild for no compensating benefit didn't seem
  worthwhile. Revisit if disk space becomes a real constraint.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from prior handoffs, 16 total): local —
  `fix/476-quarantine-status-design-call`,
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
  `fix/349-user-organization-picker` (not re-checked this session),
  plus merged-but-not-yet-deleted: `fix/541-withdraw-depleted-guard`
  and `fix/536-remove-dead-sample-releasestatus` — both still need
  manual cleanup or an explicit permission grant.

## Which issue is next

Dennis has not explicitly said which issue to pick up next session —
per this skill's "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (#548 now resolved and closed, removed from
this list; #373's tree — #549/#550/#551/#552 — is the natural
continuation but not queued without Dennis's say-so):

- **#549** — the remaining 13 sources (corrected count, see above).
  Depends on #548 (satisfied). The obvious next chunk if continuing the
  same split — same build-loop shape as #548, reusing `pipeline.js`
  as-is.
- **#550/#551/#552** — independent of #549, can be picked up in any
  order once #367 (satisfied) is the only real dependency.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`.
  Unrelated to the RF028 cluster, still open.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it?
- Older backlog, unchanged: `#371`/`#374`/`#378`/`#379`, `#368`, `#345`,
  `#341`/`#340`, `#334`, `#331`/`#326`/`#325`, `#321`, `#319`, `#286`,
  `#284`, `#283`, `#282`, `#228`, `#115`, next e2e slice per
  `E2E_TRACEABILITY_PLAN.md`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247**
  — pack-repo only, low priority, unchanged this session.
- **skills-pack#250/#251** — filed this session (see above), pack-repo
  fixes, not this project's scope to resolve.

## Dev stack state

Torn down cleanly at session end (see "Repo state" above). Named
volumes (mongodb/neo4j data, ~1.16GB) untouched — next session's
`compose up` will see the same accumulated fixture data prior sessions'
gotcha already documents. Images left cached (~4.4GB) — a next `compose
up --build` should be fast (cache hits) unless something invalidates a
layer.

## Which skills to use

- `work-issue` → `divide-and-conquer` correctly caught #373 as a
  too-big tracking issue whose own body already sketched the split —
  confirming the breakdown with Dennis before filing (per the skill's
  own rule) worked smoothly with a single `AskUserQuestion`.
- `build-loop` worked as documented for #548: primary-doc check caught
  a real gap (#549's missing Cell Ontology) before implementation
  started, Docker-on-by-default caught what native tests alone
  couldn't (the MONDO-specific real-backend assertion only means
  anything against a live Mongo).
- Two new pack-repo issues filed (skills-pack#250, #251) — see above.
  Neither blocks future sessions; both are documented workarounds in
  the interim (this handoff, plus the "not now" reasoning already given
  inline when #250's hook fired).
