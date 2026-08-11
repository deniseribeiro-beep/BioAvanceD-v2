# HANDOFF

**Written:** 2026-08-11, end of session on `feature/docker-e2e-backend-integration`,
after resolving #523 and filing #524.

## What happened this session

Dennis said "Read handoff," then picked candidates from the prior
handoff's carried-forward backlog one at a time: **#492**, then **#505**.

**#492 and #505 both turned out already resolved** — not this session's
work, but merged into this branch in earlier sessions
(`ff974237`/`6f1c77d8`, both confirmed ancestors of this branch's `HEAD`
before this session started). `work-issue`'s "verify before trusting
handoff prose" check caught both correctly via `gh issue view`. Neither
needed any action.

Dennis then said **"file missing issues from handoff, then see what we
can do from backlog, then rotate handoff."** Cross-checked every
carried-forward backlog item in the prior HANDOFF.md against actual
`gh issue` state (`#371/#373/#374/#378/#379/#386/#390/#489/#496/#368`,
the e2e-slice pointer `#331`) — all already tracked, nothing missing
there. The one genuinely missing item: the prior handoff's note about 4
failing tests in
`api/backend/tests/unit/import-lgpd.service.importSamples.unit.test.js`
(`boxId auto-assignment (#459)` describe block) had never been filed.
Reproduced (still failing), root-caused via a temporary debug trace
(reverted before committing), and filed as **#523**.

**#523 resolved this session** (`fix/523-import-lgpd-boxid-mock-findone`,
merge commit `9c0cb189`, fix commit `9fb1e51b`): the file's
`makeDbWithStorageChain()` test helper builds a `storageAssignments`
Mongo mock with only `insertOne`. `AllocateSampleUseCase` (#477) now
calls `MongoStorageRepository.findSampleById()` →
`findCurrentStorageAssignment()` (#507), which needs `findOne` on that
collection — the same stale-mock shape #513 already flagged and #510
already fixed in `sample.service.test.js`'s `mockOperationalStorage`.
Added `findOne: vi.fn().mockResolvedValue(null)` (a freshly-inserted,
not-yet-allocated sample has no current assignment — mirrors #510's
fix exactly). Stale test, not a product bug — no product code touched.
Verified: 36/36 in the file (was 32/36), 173/173 across the wider net
(`import-lgpd.service.importSamples.unit.test.js`,
`import-lgpd.service.unit.test.js`, `sample.service.test.js`,
`AllocateSampleUseCase.test.js`). Merged, closed with the merge hash
commented. Both local and remote `fix/523-*` branches deleted cleanly —
remote delete was **not** denied this time (contrast with the
recurring #392/#482 pattern noted in prior handoffs; still no reliable
predictor for when the classifier blocks it).

**Found while auditing (`wrap-up`, not a fresh pick):** the prior
handoff's carried-forward line *"#492's own note (SPREC on live
registration): the live `POST /api/samples` path still doesn't call
`specimenPreanalyticsService.recordProfile`..."* looked stale once
`#492` came back closed — but #492's actual resolution comment was
RCS-only (`qualityDomain.resolveMethodologicalQuality` +
`rcsAssessmentService.recordAssessment`), never mentioning
`specimenPreanalyticsService.recordProfile` at all. Traced it directly
in `sample.service.js#createSample`: confirmed the RCS block from #492
is there (`sample.service.js:289-306`, `:387-398`), but there is
genuinely no `specimenPreanalyticsService.recordProfile` call anywhere
in that function — unlike `import.service.js` (#501),
`import-lgpd.service.js` (#503), and `intakeWizard.js` (#505), which all
got that wiring. `#493` (the SPREC-consumer migration umbrella, closed)
never scoped `sample.service.js` either. This is a real, distinct,
still-open gap that had been mislabeled under #492's number in the
handoff prose — not a stale note describing nothing. **Filed as #524**
(not fixed — one bug/gap per iteration, per this loop's own rule).

**Process finding filed against the pack, not this repo** (Rule 0 —
skill-orchestration, not a BioAvanceD-v2 product finding):
`dyeallpies-skills-pack#236` — `work-issue`'s stale-note check (from
pack#142) stops at "the named issue is closed," without checking
whether the note's *description* still names a mechanism/file/behavior
the closed issue's actual resolution never addressed. That's exactly
what happened with #492's note above. Suggested fix in the issue: diff
the note's description against the closed issue's resolution comment
before concluding "stale, nothing to do."

**No security-relevant findings this session** — #523 was a test-only
mock fix; #524 is a filed-but-unfixed gap (best-effort snapshot
recording, not an auth/validation change).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `9c0cb189`, clean, up
  to date with origin. Contains the merge of #523's fix.
- No dangling branches from this session's own work (`fix/523-*` deleted
  both locally and remotely).
- **Pre-existing dangling branches, not touched this session** (larger
  list than previously carried forward — worth a dedicated cleanup pass
  sometime): local — `fix/476-quarantine-status-design-call`,
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
  `fix/349-user-organization-picker` (confirmed still present via
  `git ls-remote`; deletion denied by the permission classifier in the
  #349 session, not re-attempted this session).
- Issues this session: **#523 closed** (delivered, merged at `9c0cb189`).
  **#524 opened** (SPREC-recording gap in `sample.service.js#createSample`,
  not yet worked). Pack tracker: **`dyeallpies-skills-pack#236`** opened
  (process finding, not this repo's concern to fix).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

**#524 is the freshest, most-scoped candidate** — same file #492 already
touched this branch, same best-effort-recording pattern #492/#505 both
used, root cause and suggested fix already written into the issue body.

Other candidates carried forward (re-verified against `gh issue` state
this session unless noted):

- **#390** — umbrella; all sub-issues (#491/#493/#494/#495/#517/#518/#519/#521)
  closed. Still not re-assessed this session whether it should close or
  get a status comment — carrying forward again.
- **#496** — remaining backend surfaces from the canonical-data-contract
  legacy list, open.
- **#489** — full-suite vitest flakiness, open, not re-confirmed.
- **#386** — RBAC still keyed on `accessType`/`roleName` per dict-07, open.
  Note: `accessType` still appears in 14 backend `src/` files as of this
  session's grep (`auditLogger.js`, `security.service.js`,
  `auth.service.js`, `user.routes.js`, `rbac.js` middleware,
  `auth.routes.js`, `rbac-assignment.service.js`,
  `rbac-catalog-seed.service.js`, `createFirstAdmin.js`,
  `incident.controller.js`, `iot.controller.js`,
  `UserRoleAssignment.js`, `Access.js`) — not triaged this session
  (live vs. intentional-legacy-reference vs. genuinely dead), just
  confirmed #386 isn't itself stale.
- Older backlog, unchanged: `#371`/`#373`/`#374`/`#378`/`#379`, `#368`,
  next e2e slice per `E2E_TRACEABILITY_PLAN.md`/`#331`.
- **skills-pack#233/#234/#235** — pack-repo only, low priority, unchanged.
- **skills-pack#236** — new this session, see above.

## Dev stack state

Nothing started this session. All verification ran targeted `npx vitest
run` (named files only, per this loop's directory-argument-ban) — no
Docker, no live app. No backend product code changed (only a test-mock
file).

## Which skills to use

- `work-issue`'s stale-note check worked exactly as designed for #492
  and #505 (closed issue → `gh issue view` → confirmed nothing to do) —
  but stopped one step short for #492's specific note. See
  `dyeallpies-skills-pack#236` for the gap and suggested fix; don't
  re-derive the diagnosis, it's fully written up there.
- Confirmed again: `git merge-base --is-ancestor <hash> HEAD` is the
  fast, reliable way to check whether a resolution commit named in an
  issue comment is already on the current branch, before assuming a
  "resolved by commit X" comment means the work still needs doing here.
