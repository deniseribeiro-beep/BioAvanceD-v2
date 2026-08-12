# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after resolving #538 (Phase A) and filing its follow-ups.

## What happened this session

Dennis said "Pick #538" — the big `currentStatus`/3-vocabulary issue
carried forward from last session's handoff as "needs a dedicated
session." `work-issue` routed to `resolve-issue`, which (per its own
"needs owner design call" rule) checked `docs/` before treating the
vocabulary question as genuinely open.

**The design question turned out to already be answered**, not actually
needing Dennis's call on vocabulary:
- `docs/architecture/canonical-data-contract-v1.md`'s "Legacy Fields
  Prohibited" list already bans `currentStatus`/`lifecycleStatus`/
  `availabilityStatus`/`quarantineStatus` outright.
- dict-02 ELM-0123's `specimenStatus` enum already has `partial`/
  `depleted` values, and `Sample.js#computeStatus` already derives them
  correctly from quantity on every `withdrawSample`/`returnSample`
  write — the withdrawal-lifecycle concept doesn't need a new field.
- `frontend/src/types/models.ts` and `frontend/src/foundation/
  contracts.ts` (an unmounted "Foundation"/strangler-pattern scaffold,
  `FoundationApp.tsx`) already carry the intended `specimenStatus`→
  legacy-label mapping, just unused by the live withdrawal page.

Finished the trace #538 left incomplete: confirmed `Sample.js`'s
Mongoose schema does **not** declare `status`/`currentStatus` (the
writes land anyway via raw MongoDB driver calls that bypass schema
validation — `equipment-sensor-quarantine.service.js`); confirmed
`fhir-import-staging.service.js`/`import.controller.js`/`intakeWizard.js`
(the non-`.routes.js` one) do **not** write those fields (the latter
actively rejects them as `NON_CANONICAL_FIELD`); confirmed
`validateSampleStatus` (frontend) is dead, zero callers.

**Confirmed too big for one sitting** (3 live writers, 5 live readers —
same shape as the #398/#405-#408 `specimenStatus` consolidation, which
took 4 phased issues). Confirmed the phased split with Dennis via
`AskUserQuestion` before filing anything (`divide-and-conquer`'s
design-split playbook) — he picked "phase it, ship one load-bearing
slice now" and "file the two smaller side-findings separately, don't
fold into the same branch."

**#538 resolved as Phase A** (`fix/538-withdrawal-page-specimen-status`,
commit `83859258`, merge commit `fb39e6db`) — the one *confirmed-broken*
real business gate: `SampleWithdrawalReturnPage.tsx`'s `canWithdraw`/
`getPendingReturnQuantity`/initial-tab-switch used to check
`sample.currentStatus`, a field the real withdraw/return write path
never sets. Rewired onto `specimenStatus`, extracted as pure exported
functions (`resolveSpecimenStatus`/`canWithdrawSample`/
`getPendingReturnQuantity`/`resolveInitialTab`/`getSpecimenStatusColor`/
`translateSpecimenStatus`), 18 new unit tests, `tsc --noEmit` clean.
Also added a frontend-only guard blocking re-withdrawal of a `depleted`
sample (the backend's own gap here is #541, filed separately per
Dennis's call, not touched in this branch).

**Filed while resolving #538:**
- **#539** (bug, open) — Phase B: migrate remaining live readers
  (`SampleDetailsPage.tsx`, `ReportViewPage.tsx`, `reports.routes.js`,
  `userMethods.ts`) onto `specimenStatus`. No dependency, can start
  anytime.
- **#540** (bug, open) — Phase C: remove the three dead writers (intake
  wizard's `enforcePersistedGovernanceStatus`, `equipment-sensor-
  quarantine.service.js`, `eConsent.js`). **Depends on #539** — these
  readers still consume what the writers produce today.
- **#541** (bug, open) — `withdrawSample`'s `BLOCKED_SPECIMEN_STATUSES`
  doesn't include `'depleted'`, so a redundant `Total`-type re-withdrawal
  on an already-fully-withdrawn sample silently no-ops (writes a
  spurious zero-quantity ledger movement) instead of being rejected.
  Doesn't lose material (balance floors at 0) but pollutes the audit
  trail. Backend-only; the frontend already has its own guard as of
  Phase A.
- **#542** (bug, open) — frontend's `'Expired'` legacy status value has
  zero producer anywhere in the codebase (backend or frontend) — looks
  aspirational, needs Dennis's call on whether it's planned (RF014/
  retention-policy adjacent, #440/#441) or dead.
- **skills-pack#244** (enhancement, open) — `clean-up`'s branch domain
  lists local-delete and remote-delete as two bullets but doesn't say to
  issue them as two separate tool calls; chaining them with `&&` this
  session meant the classifier's denial of the remote half also blocked
  the (normally uncontroversial) local half, costing an extra
  `AskUserQuestion` round-trip. Couldn't edit `clean-up` directly per
  skill-maintenance's Rule 0.

**No security-relevant findings requiring separate filing** — all
changes this session were frontend display/gating logic reading
already-secured API responses; no new routes, no relaxed validators, no
secrets touched.

**Workflow friction this session:**
- `push-wrapup-checkpoint.cjs` fired immediately after `gh issue close
  538`, before the merge/push/branch-delete steps — same known
  early-fire pattern noted in #525/#529/#531's handoffs (fires on
  close/push, not just before branch-delete). Not re-filed, still the
  expected shape.
- Chaining local `git branch -d` + remote `git push origin --delete` in
  one `&&` Bash call got the whole compound command denied by the
  permission classifier, including the local half that's never been
  denied on its own in this project's history — filed as
  skills-pack#244 above (with the exact suggested wording) rather than
  editing the junctioned `clean-up` skill directly.
- No other denials this session (merge, push to the integration branch,
  and issue creation all went through cleanly).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `fb39e6db`, clean,
  pushed, up to date with origin. Contains #538 Phase A's merge
  (`83859258`→`fb39e6db`).
- No dangling branches from this session's own work —
  `fix/538-withdrawal-page-specimen-status` merged, closed, and deleted
  both locally and on `origin` (after an `AskUserQuestion` confirmation
  per the classifier denial above).
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged, 16 total — see prior handoffs for the full list,
  unchanged since #531/#535's sessions): local —
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
  `fix/349-user-organization-picker` (last checked during #527's
  session; not re-checked this session).
- Issues this session: **#538 closed** (Phase A merged, commits above).
  **#539, #540, #541, #542 filed** (new, open, this repo — #540 depends
  on #539). **skills-pack#244 filed** (new, open, pack repo).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per this
skill's "only if the user explicitly said so" rule, nothing is queued.

Candidates carried forward (#538 now resolved as Phase A, removed from
this list; **#539/#540/#541/#542 newly added**):

- **#539** — Phase B of the currentStatus migration: migrate
  `SampleDetailsPage.tsx`/`ReportViewPage.tsx`/`reports.routes.js`/
  `userMethods.ts` onto `specimenStatus`. Follow the pattern
  `SampleWithdrawalReturnPage.tsx` already set (Phase A) — pure exported
  helper functions, unit-tested. No dependency, ready to pick up.
- **#540** — Phase C: remove the three dead writers. **Do #539 first**
  (explicit dependency).
- **#541** — small, well-scoped backend fix (`BLOCKED_SPECIMEN_STATUSES`
  + `'depleted'`, or an explicit zero-quantity guard in `withdrawSample`).
- **#536** — `Sample.releaseStatus` (camelCase) third-field cleanup.
  Likely small (probable deletion, no live consumer found) but confirm
  no external consumer first per the issue's own caveat.
- **#537** — `GET /:id/compliance-graph`'s side-effect-on-GET API
  contract question. Needs Dennis's call on whether to split
  read/revalidate into separate endpoints.
- **#542** — needs Dennis's call on whether `'Expired'` is planned or
  dead; small either way once answered.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`,
  so #529-class drift has no CI gate. Small, well-scoped fix.
- **#390** — umbrella; all originally-tracked sub-issues closed, plus
  #496/#525/#526/#527/#528/#529/#531 also closed. Still not re-assessed
  whether it should close or get a status comment.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed.
- **#386** — RBAC still keyed on `accessType`/`roleName` per dict-07,
  open, not re-triaged this session.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it? (Confirmed again this
  session that it writes only `releaseStatus`/`status`-on-Consent, not
  Sample `status`/`currentStatus` — doesn't resolve #336's own liveness
  question, just narrows what it would affect.)
- Older backlog, unchanged: `#371`/`#373`/`#374`/`#378`/`#379`, `#368`,
  next e2e slice per `E2E_TRACEABILITY_PLAN.md`/`#331`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244** —
  pack-repo only, low priority, unchanged otherwise (#244 newly added).

## Dev stack state

Nothing started this session. Same as prior sessions: native-only
verification (vitest for the frontend unit tests, real
`tsc --noEmit`) — no Docker/live-DB needed or used, consistent with
`resolve-issue`'s targeted per-iteration default.

## Which skills to use

- `divide-and-conquer`'s design-split playbook (step 2, "confirm the
  breakdown with the user before filing anything") did real work this
  session — asking Dennis to confirm the phased split *and* how to
  handle the two side-findings, via one `AskUserQuestion` call with two
  questions, got a clean answer before any issue was filed. Worth
  reusing verbatim: confirm the shape of the split, not just that a
  split is needed.
- Confirmed again: `resolve-issue`'s "check `docs/` before treating
  something as needing an owner's design call" rule fully dissolved
  what #538's own body framed as its central open question. Worth
  restating as a pattern: when an issue's own trace already names the
  specific docs section it *didn't* check, check that section first,
  before reaching for `AskUserQuestion` on the design question itself.
- New this session: when an issue's "not yet traced" list includes
  "does the schema declare this field," don't stop at confirming it
  doesn't — check *how* the write actually lands (raw MongoDB driver
  call vs. Mongoose model method). A field genuinely absent from a
  Mongoose schema can still be persisted for real if the writer bypasses
  the ODM entirely, which changes what "the schema doesn't declare it"
  actually implies about whether the writes are live.
- Confirmed again: `push-wrapup-checkpoint.cjs`'s early-fire (relative
  to merge/branch-delete) is now the *expected* shape across six
  sessions running (#525, #529, #531, and the last two including this
  one) — treat it as permanent behavior, not a bug to keep re-noting.
