# HANDOFF

**Written:** 2026-08-11, end of session on `feature/docker-e2e-backend-integration`,
after resolving #349.

## What happened this session

Dennis said "Read handoff and pick next task." **Routing:** `work-issue`
scanned the open backlog (no `bug`-labeled issues open; `test-branch`
issues are deferred per the overlay until this branch merges to `main`,
which hasn't happened yet) and picked **#349** — a reproducible product
defect, not test-tooling — → `fix-bugs`.

**#349** (three frontend files still read/wrote `User.institution`, the
free-text field #347's hard cutover dropped from the backend entirely —
the "new user" form's "Instituição" input silently no-op'd, since the
backend no longer validates or persists it, and the users table always
showed "-"):

Investigation first established the backend's `GET /api/organizations`
endpoint (`api/backend/src/interface/routes/organization.routes.js`,
wired at `api/backend/app.js:283`) **already existed and was already
correctly implemented** — this was purely a frontend gap, which is why
it routed to `fix-bugs` rather than `build-loop` (no backend capability
needed building).

**Delivered and merged** (branch `fix/349-user-organization-picker`,
commit `810459a6`, landed on `feature/docker-e2e-backend-integration` via
a fast-forward `git pull` + push — no separate `--no-ff` merge needed,
single linear commit, per `fix-bugs`' own documented fast-forward
exception):
- `frontend/src/types/models.ts` — added `Organization` interface;
  `User.institution?: string` → `User.organizationId?: string | null`
  (Reference → `Organization.organizationId`, matching the backend
  model).
- `frontend/src/services/api.ts` + new `frontend/src/hooks/useOrganizations.ts`
  — `organizationService.getAll()` / `useOrganizations()` hook, same
  pattern as the existing `userService`/`useUsers` and
  `policyService`/`usePolicies` pairs.
- `frontend/src/views/NewUserPage.tsx` — the free-text "Instituição"
  `Input` replaced with a `<select data-testid="new-user-organization-select">`
  sourced from `useOrganizations()`, storing `organizationId`. Extracted
  the `handleSubmit` payload-sanitization block (field deletion, phone
  normalization, password/MFA handling) into a new exported
  `buildUserSubmissionPayload(formData, editingUser)` function so the
  `organizationId` normalization is unit-testable — same
  extract-a-pure-function-for-testing convention #522 used
  (`buildSubmissionPayload` in `ClinicalIntakeWizard.jsx`).
- `frontend/src/views/SystemManagementPage.tsx` — users table now
  resolves `organizationId` to the matching `Organization.officialName`
  via a new exported `resolveOrganizationLabel(organizations, organizationId)`
  helper (falls back to `-` as before, matching
  `SampleWithdrawalReturnPage.tsx`'s plain-named-export test convention,
  not the older `_test`-wrapper style).
- `frontend/src/utils/userMethods.ts` — fixed the same stale field name
  in the `createUser()` helper (confirmed dead/unused — never called
  anywhere in the app, kept only for UML-diagram fidelity per the file's
  header comment — but the issue named it explicitly, so fixed for
  consistency).
- New tests: `NewUserPage.test.tsx` (4 tests) and
  `SystemManagementPage.test.tsx` (3 tests) — first-ever test files for
  either view; the repo previously had zero `.test.tsx` coverage on
  these two.
- Verified: 7/7 new tests, full frontend suite 43/43 (all 7 test files
  repo-wide), `npm run typecheck:full` clean, all on the merged tree.
- **#349 closed** against this delivered scope, comment noting the merge
  commit hash.

**Not touched (correctly out of scope):** `User.organizationIds` (plural
— RF003 AC#3 role/institutional *scope*, not the single-org identity
field #349 was about) is already tracked separately by open issues
#340/#341 (`test-branch`, deferred until this branch merges to `main`
per the label's own convention) — no new issue needed.

**Known, harmless leftover:** remote branch
`fix/349-user-organization-picker` (already merged, fast-forward) could
not be deleted — `git push origin --delete` was denied by the
permission classifier, matching the already-documented pattern in
`fix-bugs`' overlay (BioAvanceD-v2#392/#482, no reliable predictor
found). Local branch was deleted. Whoever has push-permission slack can
delete the remote branch by hand; it's inert either way.

**No new skill/pack friction filed this session** — the fast-forward
pull was the scenario `fix-bugs` already documents and endorses
("don't force a merge bubble after the fact"); the remote-delete denial
matches the existing incident register entry, nothing new to add.

**No security-relevant findings** — client-side field rename only
(`institution` string → `organizationId` reference), no new route, no
relaxed validation; `GET /api/organizations` was already
`authenticate`-gated before this session touched it.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `810459a6`, clean, up
  to date with origin. Contains the merge of #349's fix.
- No dangling *local* branches from this session. One dangling *remote*
  branch (`fix/349-user-organization-picker`, merged, safe to delete —
  see above).
- Issues this session: **#349 closed** (delivered scope, merged at
  `810459a6`). No new issues filed.

## Which issue is next

Dennis has not yet said which issue to pick up next session; per
`handoff`'s "only if the user explicitly said so" rule, nothing is
queued.

Candidates carried forward (unchanged from prior handoff except #349's
removal; none re-verified this session unless noted):

**skills-pack#233** — pack-repo only, low priority: fix the
BioAvanceD-v2 overlay's per-iteration typecheck guidance
(`npm --prefix frontend run typecheck` resolves to `typecheck:core`,
which silently checks almost nothing) to point at `typecheck:full`
instead.

**skills-pack#234** — pack-repo only: add a data-flow-tracing rule to
`resolve-issue`'s design-call section alongside the existing
docs-enumeration rule.

**skills-pack#235** — pack-repo only: reconcile
`push-wrapup-checkpoint.cjs`'s comment-as-completion-signal heuristic
with `fix-bugs`' comment-first ending sequence. (Fired again this
session on #349's "Fixed at hash" comment, same known false-positive —
handled the same way: deferred the actual `wrap-up` invocation to the
true end.)

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
- **Pre-existing test failures noted but not fixed in a prior session:**
  4 tests in
  `api/backend/tests/unit/import-lgpd.service.importSamples.unit.test.js`
  (`boxId auto-assignment (#459)` describe block) — confirmed failing on
  the unmodified tree as of the #522 session, unrelated to that fix. No
  issue filed yet for this specifically; worth checking whether #459 or
  a fresh issue already covers it before the next session touches that
  file.
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
  `fix/515-test-smoke-cjs-graph`, and now
  `fix/349-user-organization-picker` — all safe to delete, low priority
  housekeeping, not re-verified this session).
- **Next e2e slice** (per `E2E_TRACEABILITY_PLAN.md` and
  `playwright-specs`' spec inventory) — check issue #95's tracking
  thread.
- **#368** — the analogous Patient/ParticipantIdentity migration that
  #390's split pattern mirrored — is itself still unsplit.

## Dev stack state

Nothing started this session. All verification ran targeted
`npx vitest run` (the two new test files, then all 7 frontend test files
repo-wide — small enough suite that this isn't a "bare full-suite mid-loop"
run) plus `npm run typecheck:full` (0 errors) from `frontend/` — no
Docker, no live app, no backend tests touched (no backend files were
changed this session).

## Which skills to use

- `work-issue` → `fix-bugs`: before routing, checked whether the
  backend capability the issue's "Needs" section described
  (`GET /api/organizations`) already existed — it did, fully wired —
  which is what kept this a `fix-bugs` item instead of escalating to
  `build-loop`. Worth checking this explicitly on any issue whose fix
  sounds like it needs new backend surface: grep for the route/model
  first before assuming it needs building.
- **Frontend test convention, confirmed again this session:** this repo
  has zero `.test.tsx`/`.test.jsx` files that render via
  `@testing-library/react` — every existing frontend test (
  `ClinicalIntakeWizard.test.jsx`, `SampleWithdrawalReturnPage.test.tsx`,
  now `NewUserPage.test.tsx`/`SystemManagementPage.test.tsx`) extracts a
  pure function out of the component/view and unit-tests that directly,
  either via a named `_test` export object (older files) or a plain
  named export (newer files, e.g. `getStorageLabel`,
  `buildUserSubmissionPayload`, `resolveOrganizationLabel`). Follow the
  plain-named-export style for new work — it's what the most recent
  precedent (`SampleWithdrawalReturnPage.tsx`) uses.
