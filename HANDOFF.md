# HANDOFF

**Written:** 2026-08-11, end of session on `feature/docker-e2e-backend-integration`,
after resolving #524.

## What happened this session

Dennis said "Read handoff" (summarized the prior session's state), then
**"Pick #524"** — the freshest, most-scoped candidate the prior handoff
had flagged.

`work-issue` routed #524 to **`build-loop`**: the issue named a capability
that doesn't exist in the code yet (`specimenPreanalyticsService.recordProfile`
wiring in `sample.service.js#createSample`), already spec'd by four sibling
implementations in the same codebase (#492's own RCS block in the same
function, plus #501/#503/#505's SPREC wiring in `import.service.js`/
`import-lgpd.service.js`/`intakeWizard.js`) — not a deviation from known
behavior (`fix-bugs`) and not coverage for already-correct code
(`test-loop`).

**#524 resolved this session** (`test/524-sample-service-specimen-preanalytics`
— no dedicated build-loop branch prefix exists yet, per the overlay's
`test/<slug>` fallback; merge commit `e9aa1eee`, fix commit `4793a652`):
added a `specimenPreanalyticsService.recordProfile` call to
`sample.service.js#createSample`, mirroring #492's own `RcsAssessment`
block in the same function almost line-for-line — same trigger condition
(`sample.sprec` truthy), same "once the sample has fully landed" timing
(after ledger append + storage allocation both succeed), same best-effort
error handling (caught, logged, doesn't fail sample creation), same
`sealedSpecimenPreanalyticsId` pin convention #502 established. Wrote the
failing test first (`sample.service.test.js`'s new "SpecimenPreanalytics
snapshot recording (#524)" describe block, 3 cases: records + pins,
skips when no sprec, doesn't fail creation on a rejected recordProfile —
mirrors the existing "RCS server-side computation (#492)" describe block
in the same file), confirmed it failed against the unmodified code,
implemented, confirmed it passed. Updated
`docs/architecture/canonical-data-contract-v1.md`'s `SpecimenPreanalytics`
section with a "Live registration SpecimenPreanalytics recording — landed
#524" note, per build-loop's step 4 (the doc explicitly tracked every
sibling creation path's wiring status; leaving it unrecorded would have
reintroduced the exact staleness #524 itself was found through).

Verified: 91/91 in `sample.service.test.js` (was 88 passing + 3 new),
174/174 across the wider net (`sample.service.test.js`,
`sample.service.unit.test.js`, `import.service.sprec.test.js`,
`import-lgpd.service.importSamples.unit.test.js`,
`import-lgpd.service.unit.test.js`). Merged, pushed, closed with the
merge hash commented. Local `test/524-*` branch deleted cleanly — no
remote delete needed, the fix branch was never pushed on its own (only
the integration branch was pushed, post-merge).

**No security-relevant findings this session** — #524 is a best-effort
snapshot-recording addition, same shape as #492/#501/#503/#505, no
auth/validation surface touched.

**No friction this session** (`wrap-up` ran, found nothing to file) —
scope matched build-loop's playbook exactly, the sibling pattern was
unambiguous so no judgment calls were needed.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `e9aa1eee`, clean, up
  to date with origin. Contains the merge of #524's fix.
- No dangling branches from this session's own work
  (`test/524-sample-service-specimen-preanalytics` deleted locally; never
  existed remotely).
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from the prior handoff — worth a dedicated cleanup
  pass sometime): local — `fix/476-quarantine-status-design-call`,
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
- Issues this session: **#524 closed** (delivered, merged at `e9aa1eee`).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per this
skill's "only if the user explicitly said so" rule, nothing is queued.

Candidates carried forward from the prior handoff (not re-verified
against `gh issue` state this session unless noted):

- **#390** — umbrella; all sub-issues (#491/#493/#494/#495/#517/#518/#519/#521)
  closed. Still not re-assessed whether it should close or get a status
  comment — carrying forward again.
- **#496** — remaining backend surfaces from the canonical-data-contract
  legacy list, open.
- **#489** — full-suite vitest flakiness, open, not re-confirmed.
- **#386** — RBAC still keyed on `accessType`/`roleName` per dict-07, open.
  Not re-triaged this session (live vs. intentional-legacy-reference vs.
  genuinely dead) — see the 2026-08-11 handoff's grep results (14 backend
  `src/` files) if picking this up.
- Older backlog, unchanged: `#371`/`#373`/`#374`/`#378`/`#379`, `#368`,
  next e2e slice per `E2E_TRACEABILITY_PLAN.md`/`#331`.
- **skills-pack#233/#234/#235/#236** — pack-repo only, low priority,
  unchanged.

## Dev stack state

Nothing started this session. All verification ran targeted `npx vitest
run` (named files only, per this loop's directory-argument-ban) — no
Docker, no live app, despite build-loop's Docker-on-by-default default:
this slice was a backend-internal service-logic change (not one of the
milestone's own e2e Playwright specs), so the overlay's "strongest
native-only proof" bar applied instead — a mocked Mongo collection
(`specimenPreanalytics`) exercising the real `specimen-preanalytics.service.js`
code, not a stub returning canned data. No backend product code changed
outside `sample.service.js`.

## Which skills to use

- `build-loop` worked exactly as documented for a single-function,
  spec-already-established-by-sibling-code slice: write the failing test
  against the sibling pattern first, implement by mirroring the sibling
  block almost verbatim, update the architecture doc that already tracked
  every other creation path's wiring status. No deviations, no judgment
  calls needed — the four sibling implementations (#492/#501/#503/#505)
  left nothing ambiguous.
- Confirmed again: a fix/build-loop branch that's only merged locally
  (never pushed on its own before the merge) needs no remote
  branch-delete step afterward — only the integration branch push
  matters. Don't treat "remote ref does not exist" on a post-merge
  `git push origin --delete` as a permission-classifier denial (the
  #392/#482 pattern prior handoffs tracked); it's simply expected when
  the fix branch was local-only.
