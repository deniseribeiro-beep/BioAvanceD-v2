# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after resolving #536 and #537 (Dennis said "Read handoff and pick issues
#536 & #537").

## What happened this session

Dennis said "pick #536 & #537." Both were carried forward in the prior
handoff as "needs a decision, same shape as #532" — `work-issue`'s rule to
re-verify a carried-forward "needs owner's call" claim rather than trust
it applied to both.

**#536** (`Sample.releaseStatus`, camelCase, a third undead legacy status
field never folded into `specimenStatus`) — the issue's own text asked to
"confirm no external consumer... since the trace above only covered
`api/backend/src` and `frontend/src`" before deleting. Ran that check
repo-wide this session: grepped the whole tree (backend, frontend, docs,
the canonical-dictionary catalog JSON, and the RF/RNF requisitos index).
Found zero readers of `Sample.releaseStatus` — the only other
"releaseStatus" hits are the unrelated `ReferenceDatasetRelease.releaseStatus`
field (different entity, dataset-release lifecycle, RF028). That satisfied
the issue's own caveat, so no `AskUserQuestion` round-trip was needed —
proceeded straight to `fix-bugs`.

**#536 resolved** (`fix/536-remove-dead-sample-releasestatus`, commit
`6686ba8e`, merged into the integration branch at `1c2cdaae`) — deleted
the schema field/default (`Sample.js`) and every writer
(`import.service.js` ×2 reconciliation blocks + row-builder field,
`import-lgpd.service.js` ×2, `fhir-import-staging.service.js` ×2,
`import.controller.js` ×2 incl. a dead log field). Un-weakened every test
pinned to the removed field across 6 test files (11 files touched total).
Targeted vitest: 226 tests / 10 files green, both before and after the
merge.

**#537** (`GET /:id/compliance-graph`'s side effect now mutates
`specimenStatus`/`QuarantineAction`, not just a cosmetic field since
#532) — this one is a genuine product/API-contract call (revalidate-on-GET
vs. splitting read/revalidate into separate endpoints); no doc settled
it, so asked Dennis directly via `AskUserQuestion`. **Decision: keep GET
as revalidate-and-persist (status quo), no API split** — the #532
safeguards (never downgrade a stronger unrelated block; no duplicate
`QuarantineAction` for a stable re-evaluation) already bound the blast
radius, and a GET/POST split wasn't judged worth the
`sample.routes.js`/`SampleDetailsPage.tsx`/test churn.

**#537 resolved** (`fix/537-compliance-graph-get-side-effect-decision`,
commit `74e91c72`, merged into the integration branch at `3a737577`) —
recorded the decision in `docs/architecture/canonical-data-contract-v1.md`
next to where #537 was originally flagged (#532's entry). No code change.

**Security/safety note:** none for either issue — #536 is pure dead-write
removal (no trust boundary touched); #537 is a decision to keep existing
behavior, not a new surface.

**New finding, filed as #546** (not chased further, out of #536's scope):
while editing `import.service.js` for #536, noticed its CSV/XLSX
sample-row builder sets `consentTemplateId` twice in the same object
literal (harmless — both assignments are identical — but a
copy-paste-leftover shape; needs the owner's call on whether a different
field was meant there before just deleting the duplicate).

**Workflow friction this session:** remote branch deletion for
`fix/536-remove-dead-sample-releasestatus` was denied by the permission
classifier — matches the already-documented precedent in `fix-bugs`'
local-env overlay (no new pattern, left the merged remote branch in
place). `fix/537-...`'s remote delete was *not* denied (succeeded
cleanly), reinforcing that overlay's "no reliable predictor found" note
rather than contradicting it. No new skill edits needed this session.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `3a737577`, clean,
  pushed, up to date with origin. Contains #536's merge (`6686ba8e`→
  `1c2cdaae`) and #537's merge (`74e91c72`→`3a737577`).
- `fix/536-remove-dead-sample-releasestatus`: merged, closed out, deleted
  locally; **remote delete denied by classifier — still exists on
  origin**, needs manual cleanup or an explicit permission grant.
- `fix/537-compliance-graph-get-side-effect-decision`: merged, closed
  out, deleted both locally and on origin — no denial this session.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged, 16 total — see prior handoffs for the full list,
  unchanged since #531/#535/.../#543's sessions): local —
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
  session; not re-checked this session), plus **the merged-but-not-yet-
  deleted `fix/541-withdraw-depleted-guard`** (flagged in #541's handoff
  as remote-delete-denied, still needs manual cleanup), plus **this
  session's new addition: `fix/536-remove-dead-sample-releasestatus`**
  (same shape — merged, remote-delete-denied).
- Issues this session: **#536 closed** (fix `6686ba8e`, merge
  `1c2cdaae`). **#537 closed** (decision `74e91c72`, merge `3a737577`).
  **#546 opened** (duplicate `consentTemplateId` key in
  `import.service.js`, found while resolving #536, not chased).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per this
skill's "only if the user explicitly said so" rule, nothing is queued.

Candidates carried forward (#536/#537 now resolved, removed from this
list; #546 added):

- **#544** — remove the `status: 'AVAILABLE'` write from
  `MongoStorageRepository.js`'s `allocateSamplePosition`/
  `autoAssignSamplePosition` (5th legacy-status writer, storage
  allocation subsystem, filed during #540's session). Small,
  well-scoped, same shape as #540's fix.
- **#546** — `import.service.js`'s CSV/XLSX row builder sets
  `consentTemplateId` twice (duplicate object key, harmless but
  copy-paste-shaped); needs owner's call on whether a different field
  was meant there. New this session.
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
  code to remove, or does something still call it?
- Older backlog, unchanged: `#371`/`#373`/`#374`/`#378`/`#379`, `#368`,
  next e2e slice per `E2E_TRACEABILITY_PLAN.md`/`#331`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247** —
  pack-repo only, low priority, unchanged this session.

## Dev stack state

Nothing started this session. Same as prior sessions: native-only
verification (targeted `vitest run` for backend) — no Docker/live-DB
needed or used, consistent with `resolve-issue`'s targeted per-iteration
default.

## Which skills to use

- Confirmed again: `work-issue`/`resolve-issue`'s "re-verify a
  carried-forward 'needs owner's call' claim rather than trust it" rule
  — this is the fourth session in a row (#538, #542, #543, now #536)
  where re-tracing turned a "needs Dennis" issue into a self-resolvable
  one, this time via a repo-wide grep satisfying the issue's own stated
  caveat rather than via a docs-policy match. Not every "needs owner's
  call" dissolves this way, though — **#537 in this same session was a
  genuine one**: no doc or grep settles an API-contract tradeoff
  (GET-with-side-effect vs. a read/revalidate split), so it correctly
  went to `AskUserQuestion` rather than being resolved solo. Worth
  carrying forward: the distinguishing signal is whether the issue's own
  ambiguity is a *fact* not yet checked (consumer trace, doc policy) vs.
  a *preference* only the owner can set (API shape, UX tradeoff) — the
  former dissolves under investigation, the latter doesn't.
- New this session: for a "needs owner's call" issue that resolves as
  "no code change" (like #537), the resolution still needs a durable
  record — recorded the decision in the architecture doc where the
  question was originally raised, then closed the issue pointing at that
  doc commit, rather than leaving the decision only in the issue-close
  comment (which is easy to miss on a later doc read).
