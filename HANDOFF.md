# HANDOFF

**Written:** 2026-08-19, same day as the prior rotation (docs-first
sweep). This sitting: Dennis asked to "pick all open RNF007 and RF007
issues" -- driven as an `issue-loop` queue sweep. **#567, #574, #283,
and #334 all closed**, plus two new issues filed (#640 security-relevant
finding, #641 divide-and-conquer split) and one pack issue (#342).

## What landed this sitting

- **#567** (RNF007 AC#5 follow-up -- `reidentifyParticipant`'s
  Administrador-only scope and free-text `reason` field): closed, no
  code change. Asked Dennis directly; he said check docs first. A bounded
  Explore agent confirmed RNF007 AC#5 (`docs/docs-7-31-2026/1-Requisitos-...md`,
  lines 901-917) doesn't mandate a narrower role or a reason taxonomy --
  per Dennis's steer, current implementation stands. Recorded the
  reasoning in the issue comment.
- **#574** (RF005/RNF007 -- cut ParticipantIdentity's civil-identity
  fields over to ciphertext-only): closed, 3 slices, each merged/pushed
  separately.
  1. Mechanical consumers (`consent.controller.js`, `eConsent.js`,
     `consent.service.js`, `sample.service.js`) now decrypt via
     `participantIdentity.service.js#decryptIdentity` instead of reading
     plaintext directly. Commit `6d2c981e`.
  2. Added `identityDocumentHash`/`birthDateHash` blind-index siblings
     (HMAC-SHA256, `fieldEncryption.js#hmacBlindIndex`), wired into
     `encryptIdentityFields` (benefits every writer automatically).
     Repointed `import.service.js`, `intakeWizard.js`,
     `PatientIdentityService.js` to query hash-first with a plaintext
     `$or` fallback for pre-existing records. Commit `e2c4dfa5`.
  3. `reports.routes.js`'s `patientName` keyword search: researched docs
     (RNF002 AC#2 forbids full-collection scans at 100k-record scale,
     RF008's filter list excludes name search, RNF007 AC#4 requires
     pseudonymization-by-default), presented findings to Dennis with
     three options -- his call: **removed the feature entirely**
     (`participantId`-only search remains). Commit `d954b628`.
  - All 3 slices merged to `feature/docker-e2e-backend-integration`,
    pushed through `7430471d` / `d94d061b` / `0dcee94d`.
- **#283** (canonical-data-contract-v1.md stale against ParticipantIdentity
  segregation): closed. Re-checked fresh rather than trusting the prior
  "dedicated-session task" deferral -- the original complaint (patientName/
  birthDate/identityDocument listed as direct Participant fields) was
  already fixed by #560-#575's own doc-sync discipline. What was still
  stale: the doc's ciphertext-cutover status paragraph described #574's
  *pre-work* state. Rewrote it to reflect current reality. Scoped to the
  ParticipantIdentity section only, not a full audit against the
  26-domain/79-entity manuscript spec. Commit `406f030c`, merged/pushed
  at `77bd191c`.
- **#334** (RF007 remainder: assayId/datasetId linkage + file-replace
  audit): closed, file-replace half landed, linkage half split to #641.
  - Added `SampleFileController#replaceFile` (`PUT
    /api/samples/:specimenId/files/:fileID/replace`, RF007 AC#7's
    missing "substituição" audit verb) -- re-runs the checksum/encryption
    pipeline, validates before removing the previous physical file, audits
    via `action: 'file_replace'`. 88/88 native tests. Commit `70756d04`.
  - **Docker verification** (Dennis's call, brought the stack up this
    sitting): running the real RF007 e2e spec caught a genuine bug native
    tests couldn't see -- `requirePermission`'s PUT->UPDATE default action
    mapping didn't match `uploadSampleFiles`'s CREATE-only
    `allowedActions`, 403ing every real request. Fixed per the
    established `#631` pattern (explicit `'CREATE'` action override).
    Extended `tests/e2e/scientific-data-access.spec.ts` with a
    replace-and-audit test, 4/4 passing against `compose.test.yml`.
    Commit `bfb2fde6`. Merged/pushed at `96dc6513`.
  - assayId/datasetId linkage split to **#641** (new issue): confirmed
    `Study`/`Protocol` models already exist and are reusable, no `Assay`/
    `Dataset` model exists yet, full dictionary field scope written up
    (ELM-0286-0297, ELM-0416-0423) so a future session doesn't re-derive
    it. Genuinely needs its own design call (AC#6 requires files to link
    to specimenId **or** assayId/studyId/datasetId, which implies a
    routing-shape decision beyond just adding fields).

## Other findings this sitting

- **Filed #640** (security-relevant, BioAvanceD-v2): `PatientIdentityService.js#matchOrUpsertParticipant`'s
  identity writes bypass `encryptIdentityFields` entirely -- records
  created/updated through the intake-wizard match/upsert path get no
  ciphertext/hash siblings at all, unlike every other writer. Found
  while tracing #574's slice 2 read consumers. Not fixed inline (doesn't
  block #574's own AC), filed immediately per the security-finding rule.
- **Filed #641** (BioAvanceD-v2): the assayId/datasetId linkage split
  from #334, see above.
- **Filed dyeallpies-skills-pack#342**: the docs-first-before-
  `AskUserQuestion` fix from pack#340 lives in `resolve-issue`'s text,
  but this session called `AskUserQuestion` on #567's two sub-questions
  *before* invoking `resolve-issue` (or any workflow skill) at all --
  during initial ad hoc issue-discovery triage, prompted by "pick all
  open RNF007/RF007 issues." A third recorded occurrence of the same
  failure shape (2 in #340, this one) -- flagged as needing a mechanical
  fix (a PreToolUse-style guard), not just prose, given prose has now
  been re-skipped three times.

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed through `96dc6513`.
  Working tree clean except the gitignored/junctioned `.claude/skills/`.
- All 5 session branches (3x `test/574-*`, `test/283-*`, `test/334-*`)
  merged, deleted locally (never pushed remotely) -- see `clean-up`'s
  branch-domain check, single-author verified per commit.
- **Docker**: `compose.test.yml` was brought up this sitting (Dennis's
  explicit call, to prove #334's file-replace endpoint against the real
  backend) and torn down at session end (`compose.test.yml down`,
  Dennis's call, queue was empty). `backend-app-test`'s session-rebuilt
  image removed, build cache pruned (~888MB). Named volumes
  (`mongodb-test-data` etc.) persist for next time. Pre-existing images
  from prior sessions (frontend-app-test, the 15 `reference-data-bootstrap-*`
  images, etc.) left untouched -- not this session's to judge.
- **Only targeted native tests + one real-backend e2e spec run this
  sitting** -- no full-suite/`--coverage` backend run, no frontend
  `typecheck:full`. Per the conventions skill's gate order, this is the
  correct per-iteration tier; the full suite is `ship-integration-branch`'s
  job, not asked for yet. No PR to `main` exists.
- **#628's migration script (`backfillResultSpecimenIds.js`)** still not
  run against any real environment -- older than this sitting, unrelated,
  still outstanding.
- Stale local+remote branch `fix/599-ci-trigger-integration-branch`
  (unrelated, still-open issue #599) still noted in passing, never
  touched.

## Docs sweep carryover (from the prior rotation, still accurate)

- **#115** (`syncFromOrphadata` partial-coverage risk): still correctly
  deferred to the canonical terminology data-modeling phase per Denise's
  own prior comment -- not re-touched this sitting.

## Recommended next steps

None queued -- Dennis didn't name a next issue this sitting. If picking
this repo back up:
1. Re-check the open backlog fresh (`gh issue list --state open`) --
   this sitting's docs-driven RNF007/RF007 sweep is now fully closed
   out; nothing else was triaged this sitting.
2. **#641** (Assay/Dataset entities + generalized scientific-file
   linkage) is the most concretely scoped next build-loop-shaped task if
   continuing the RF007 thread -- field scope, existing-model reuse, and
   the routing-shape design question are all written up on the issue.
3. **#640** (PatientIdentityService encryption gap) is a small, clearly
   scoped security-relevant fix -- route both `$set` blocks in
   `matchOrUpsertParticipant` through `encryptIdentityFields`, mirroring
   `import.service.js`'s precedent.
4. Consider a full native-suite re-run before treating the branch as
   verified-green end-to-end -- this sitting only ran targeted tests plus
   one real-backend e2e spec, not the full suite.
