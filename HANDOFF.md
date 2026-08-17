# HANDOFF

**Written:** 2026-08-17, continuation session (thirteenth update). User
said "pick the next group of issues to resolve, try 5," AFK for the
whole session, Docker explicitly on. No divide-and-conquer needed —
worked solo through the batch; deliberately declined to squeeze a 6th,
riskier item in (see "Deliberately not picked up" below).

## Issues closed this session

- **#577**: `E2E_TRACEABILITY_PLAN.md`'s Grouping-strategy table still
  named `participant-consent-studies.spec.ts`, a proposed spec file
  that was never created — RF004/RF005/RF010/RF020/RF021 landed in
  topic-specific files instead. Updated the table row plus an
  explanatory note with the real per-RF file mapping. Doc-only.
- **#319**: `.env.test.example`'s `TEST_SUPPORT_SECRET` diverged from
  `compose.test.yml`'s hardcoded `x-test-env` anchor value (every other
  value in that file already mirrors the anchor literally). Aligned it.
  Doc/config-only.
- **#569**: `intakeWizard.js#buildSampleDocumentFromIntake` wrote a
  denormalized plaintext civil-identity name (`participantName`)
  directly onto every intake-created `Sample` document — no schema
  declaration, so nothing stripped it on the raw-driver `insertOne`,
  and it round-tripped unprojected through `listSamples`/`getSample`
  with no gate/audit trail, bypassing the `reidentifyParticipant`-gated
  flow (#560) entirely. Investigated first (grepped the whole backend +
  frontend): no display/list/export consumer read it; the only other
  reader, `MerkleService.generateSampleHash`, treats it as an optional
  fallback input. Removed the write; added a regression assertion.
  57/57 tests green, lint clean.
- **#321**: confirmed `AllocateSampleUseCase`/`MoveSampleUseCase`/
  `ReleaseSampleUseCase` are reachable from real routes
  (`storage.routes.js` + `storageApi.ts`'s UI flow), not dead code.
  Building the real-backend e2e proof surfaced a live bug:
  `release-sample.controller.js` passed `{ sampleId }` to a use case
  that reads `command.specimenId` — every real release call 400'd
  immediately. Fixed inline (blocked the issue's own acceptance
  criteria); the existing unit test had actually encoded the bug as
  expected behavior, corrected it and added a dedicated regression test
  mirroring #482's equivalent allocate-side fix. Added
  `tests/e2e/sample-storage-lifecycle.spec.ts`: real-backend
  create→move→release→re-allocate round trip against the actual
  replica-set-backed `compose.test.yml` stack, asserting the audit
  trail at each transactional step, plus a `STORAGE_COLLISION` negative
  case. First run failed against a stale `backend-app-test` image
  (builds from source, not bind-mounted — same shape as the known
  `frontend-app-test` gotcha, just never confirmed for the backend);
  passed 2/2 clean after a targeted `--build` rebuild. 83/83 related
  unit tests green, lint clean.
- **#378**: cross-checked the 3 gates the 2026-07-31 Foundation Data
  Pipeline doc amendment added, against actual coverage. **F3-G10**
  (specimen custody transactions) — satisfied, proven by #321 above.
  **F2-G09** (multi-endpoint coverage manifest) — real gap in
  principle but not currently triggered (none of the 16 operational
  Fase 2 sources are multi-endpoint); the one live multi-endpoint path,
  `syncFromOrphadata`, already has an open tracking issue (#115) —
  commented there linking the fuller gate language instead of filing a
  duplicate. **F3-G09** (reports/exports org scope) — real, unmet gap;
  already fully tracked by #340+#341 (see below). Findings recorded
  directly in `E2E_TRACEABILITY_PLAN.md` (the file that had flagged
  this as "not done in this pass"). Doc-only.

## Deliberately not picked up: #340/#341 (institutional-scope enforcement)

`#348` (Sample/Patient real `Organization` reference wiring) closed
since #340/#341 were filed, so both are now technically unblocked. Did
**not** attempt #340 this session even though it fit the "try 5" slot:
it's a genuinely novel authorization primitive (no existing scope-filter
precedent anywhere in `rbac.js`), needs correct answers to real security
edge cases no doc settles (does an org-less user see nothing or
everything? is `hierarchyLevel 4`/Administrador the only bypass?
403 vs 404 on out-of-scope direct access?), and spans 4 endpoints
(sample+patient, list+detail) plus a real-backend proof. Shipping a
guessed answer to those edge cases with no review — AFK, no live
check-in available this session — risks either a data-leak-shaped hole
or breaking legitimate access, and a half-wired version of it would give
false confidence that org-scoping is enforced when it isn't everywhere
yet (the "half-applied invariant lies" case, not a chunking candidate).
Picked #378 instead — same backlog area, but investigation/doc-only, no
new authorization surface. #340/#341 are ready for a session where
Dennis can settle those edge-case calls up front, ideally in the same
sitting since #341 explicitly depends on #340 landing first.

## Other work this session

- **Filed `DyeAllPies/dyeallpies-skills-pack#333`**: `backend-app-test`
  (like `frontend-app-test`, #329) builds its Docker image from source,
  not a bind mount — a stale image silently serves pre-fix backend code
  with no error. Found via #321's first (failing) e2e run.
- **Filed `DyeAllPies/dyeallpies-skills-pack#334`**: spec-inventory
  addition for the new `sample-storage-lifecycle.spec.ts`.
- Both filed as skills-pack issues rather than edited directly, per
  skill-maintenance Rule 0 (this session isn't in the pack repo).
- **Commented on #115** (still open): linked it as the tracking issue
  for gate F2-G09, noting the full gate text is broader than #115's
  original framing.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed to `origin` after
  every issue this session (5 separate merge+push cycles, not batched
  at the end). Working tree clean except the gitignored/junctioned
  `.claude/skills/`.
- Docker: brought the `compose.test.yml` stack up once for #321's
  real-backend e2e proof (core services + `admin-bootstrap-test`,
  rebuilt `backend-app-test` once mid-slice), tore it down clean
  (`docker compose down`, no `-v` — named volumes/fixtures untouched)
  once the spec passed. `docker builder prune -af` run after (safe,
  build-cache-only). **Left the ~20 pre-existing tagged test images
  alone** (`bioavanced-test-*`, ~619MB each, mostly
  `reference-data-bootstrap-*` variants from a prior session, not built
  this session) — removing them wasn't this session's call to make
  unilaterally; ask Dennis before a `docker rmi` sweep if disk space is
  a concern.
- Local branches for this session's work already deleted (merged +
  issue closed): `test/577-e2e-plan-grouping-table`,
  `test/319-test-support-secret-drift`,
  `fix/569-sample-participant-name-denormalization`,
  `test/321-sample-storage-usecases-e2e`,
  `test/378-foundation-pipeline-v2.1.1-gate-check`.
  `fix/599-ci-trigger-integration-branch` and
  `fix/599-hold-ci-trigger-for-milestone` still intentionally kept from
  a prior session (both merged, #599 itself still open pending
  milestone #2 — unrelated to this session, not touched).

## Recommended next steps

None queued by the user. Natural candidates for a future session, in
rough order:
1. **#340 then #341** (institutional-scope enforcement) — see "Deliberately
   not picked up" above; needs Dennis's input on the edge cases before
   implementation starts, not a solo pickup.
2. **#602** (`PERMISSION_CATALOG.allowedActions` is decorative-only) —
   also a judgment call the filer explicitly flagged as "bigger than a
   drive-by" (enforce per-verb vs. correct-as-metadata-only); left
   untouched this session for the same reason as #340.
3. `#367`'s coverage-reconciliation piece for `syncFromOrphadata`
   (#115/F2-G09) — needs real Orphadata API context per #115's own text.
