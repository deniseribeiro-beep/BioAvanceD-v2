# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after resolving #543 (Dennis said "Read handoff, pick issue #543").

## What happened this session

Dennis said "pick #543." `work-issue` read the issue body:
`frontend/src/utils/userMethods.ts` (`createUser`, `validateUserStatus`,
`registerPatient`, `registerSample`, `recordSampleWithdrawal`,
`generateReports`, `viewTemperatureControl`, `registerSensor`,
`getLogs`) had zero live callers anywhere in `frontend/src` (confirmed
by grep) — a UML-diagram-to-code scaffold ("Implementação dos métodos
da classe User conforme diagrama UML") never wired into any component,
hook, or service call, with `services/api.ts` already providing the
real, live implementation of the same-named operations. The issue's own
text explicitly asked for Dennis's call on delete vs. wire-in.

Per `work-issue`'s "needs owner's call → check `docs/` first" rule,
checked `docs/architecture/canonical-active-surface.md` before
escalating. It didn't list `userMethods.ts` by name (it's a
`2026-07-08` snapshot, not exhaustive), but it states a general,
directly-applicable policy for this exact shape: `frontend/src/components/v2/*`
legacy surfaces not imported by `App.tsx` "should be deleted rather
than normalized in place." Combined with `services/api.ts` already
owning the live implementation (so wiring `userMethods.ts` in would
create a duplicate/conflicting implementation, not fill a gap), that
settled the delete-vs-wire-in call the same way `dict-02_DICIONARIO.md`
settled #542's — no `AskUserQuestion` round-trip needed.

**#543 resolved** (`fix/543-remove-dead-usermethods`, commit
`82874805`, merged into the integration branch at `2a708dff`) —
deleted `frontend/src/utils/userMethods.ts` and its unit test
(`userMethods.test.ts`, added by #539 to cover the pure `registerSample`
function). `tsc --noEmit` clean; `frontend/src/utils` vitest suite (20
tests) green, both before and after the merge.

**Security/safety note:** none — pure dead-code removal, no trust
boundary or persisted-data behavior touched.

**Workflow friction this session:** one hook inconsistency, filed as
`dyeallpies-skills-pack#247` (not a BioAvanceD-v2 issue — the matcher
logic lives in the pack's hook, not this repo's code). The
targeted-vitest guard blocked `npx vitest run src/utils` when chained
via `&&` after `npx tsc --noEmit`, with the exact "one bare directory
doesn't count as targeted" message — but the byte-identical standalone
`npx vitest run src/utils` call had succeeded moments earlier in the
same session, both before and after this. Splitting the chained command
back into two separate Bash calls worked both times. Trivial workaround
(don't chain a vitest call with `&&`), but the block/allow outcome for
the same arguments depending only on chaining shape is worth the pack
maintainer's look.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `2a708dff`, clean,
  pushed, up to date with origin. Contains #543's merge
  (`82874805`→`2a708dff`).
- `fix/543-remove-dead-usermethods` merged, closed out, and deleted both
  locally and on `origin` — no remote-delete denial this session.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged, 16 total — see prior handoffs for the full list,
  unchanged since #531/#535/#538/#539/#540/#541/#542's sessions): local —
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
  deleted `fix/541-withdraw-depleted-guard`** (flagged in #541's
  handoff as remote-delete-denied; still needs manual cleanup or an
  explicit permission grant — not re-attempted again this session).
- Issues this session: **#543 closed** (fix `82874805`, merge
  `2a708dff`). No new project issues opened (the one finding this
  session — the hook chaining inconsistency — was pack-repo mechanics,
  filed as `dyeallpies-skills-pack#247` instead).

## Which issue is next

Dennis has not yet said which issue to pick up next session; per this
skill's "only if the user explicitly said so" rule, nothing is queued.

Candidates carried forward (#543 now resolved, removed from this list):

- **#544** — remove the `status: 'AVAILABLE'` write from
  `MongoStorageRepository.js`'s `allocateSamplePosition`/
  `autoAssignSamplePosition` (5th legacy-status writer, storage
  allocation subsystem, filed during #540's session). Small,
  well-scoped, same shape as #540's fix.
- **#545** — `SampleDetailsPage.tsx`'s "Status Atual" edit dropdown is a
  no-op since #540 stopped persisting `currentStatus`. Needs a product
  call: remove the control, or make it read-only.
- **#536** — `Sample.releaseStatus` (camelCase) third-field cleanup.
  Likely small (probable deletion, no live consumer found) but confirm
  no external consumer first per the issue's own caveat.
- **#537** — `GET /:id/compliance-graph`'s side-effect-on-GET API
  contract question. Needs Dennis's call on whether to split
  read/revalidate into separate endpoints.
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
  pack-repo only, low priority, unchanged this session except #247
  (new, filed this session).

## Dev stack state

Nothing started this session. Same as prior sessions: native-only
verification (`tsc --noEmit` + targeted `vitest run` for frontend) — no
Docker/live-DB needed or used, consistent with `resolve-issue`'s
targeted per-iteration default.

## Which skills to use

- Confirmed again: `work-issue`/`resolve-issue`'s "if the issue frames
  this as needing the owner's design call, check `docs/` first" rule —
  this is the third session in a row (#538, #542, #543) where a
  "needs owner's call" issue turned out to be directly settled by an
  existing doc's stated policy, not an ambiguous judgment call. Worth
  noting: `canonical-active-surface.md`'s policy statement
  ("legacy surfaces not imported by `App.tsx` should be deleted rather
  than normalized in place") was written about `frontend/src/components/v2/*`
  specifically, but applied cleanly to a different orphaned file
  (`utils/userMethods.ts`) once the same "unimported, has a live
  replacement elsewhere" shape was confirmed — a doc's stated policy
  can settle a design call even when the doc doesn't name the specific
  file, as long as the shape it's addressing genuinely matches.
- New this session: chaining a targeted `vitest run <dir>` call with
  `&&` after another command can flip the vitest-guard hook's
  block/allow decision for the exact same vitest arguments — filed as
  `dyeallpies-skills-pack#247`. Until fixed, keep targeted vitest runs
  in their own standalone Bash call rather than chaining them.
