# HANDOFF

**Written:** 2026-07-31, a `build-loop` session closing out **#363**
(RF005/RNF007 ParticipantIdentity segregation, Wave 2 red-first
prerequisite) on `feature/docker-e2e-backend-integration`, picked up
directly from Dennis right after the #330 close-out — dev stack
(`compose.yml`) was already up from prior sessions (~2h) and left running.

## What happened this session

1. Routed via `work-issue` → `build-loop`: #363 asked for the
   `ParticipantIdentity` model/migration that turns `intake-wizard.spec.ts`'s
   RF005/RNF007 AC#1/AC#2 red assertions (#327) green — civil identity
   (`patientName`/`birthDate`/`identityDocument`) must not appear as direct
   fields on the participant resource.
2. Issue itself flagged this as likely multi-slice (new entity + migrating
   ~20 existing consumers off `Patient` + an audited re-identification
   flow) and said to use `divide-and-conquer` if it didn't fit one
   iteration — confirmed the blast radius via grep (20 files reference
   `patientName`/`birthDate`/`identityDocument` in `api/backend/src`) before
   starting, and scoped down to a landable first slice rather than
   attempting the full migration:
   - New `ParticipantIdentity` model (`api/backend/src/models/ParticipantIdentity.js`)
     + `participantIdentities` collection (registered in
     `config/collections.js`), dual-written alongside `Patient` at intake
     (`patient.service.js#createPatient`) — `Patient` itself still keeps
     the fields internally for now, since removing them there would break
     the other ~20 consumers.
   - `paciente.controller.js#buscar` (`GET /api/patients/:id`) now strips
     `patientName`/`birthDate`/`identityDocument` from its response for
     every caller, regardless of `createPatient` permission.
   - Updated `docs/architecture/canonical-data-contract-v1.md` with a new
     ParticipantIdentity section documenting what landed vs. what's
     deferred.
   - Fixed pre-existing staleness in
     `tests/unit/config/collections.test.js` (missing `organizations` key
     in its `DEFAULTS`, predating this change) while adding the new
     `participantIdentities` key, since the test would otherwise fail on
     an unrelated gap.
3. Verified both AC#1/AC#2 and AC#3 (Neo4j outbox never carries identity
   fields — was already green) pass against the real, already-up dev-stack
   backend. Ran the full backend `vitest` suite (6319 tests): 3 failures,
   all confirmed pre-existing/flaky in isolation (one exact-millisecond
   timing assertion in `NotificationService.test.js`, unrelated to this
   change) — none caused by this diff.
4. Chased what looked like a regression in the **mocked**-auth
   `intake-wizard.spec.ts` tests (intermittent redirect to `/login`) —
   A/B tested via `git stash` and confirmed via isolating file groups that
   it reproduces identically with or without this session's diff, so it's
   pre-existing dev-stack flakiness, not a regression. Filed as **#369**
   (audit logger flooding logs with `Tipo não suportado na canonicalização
   JSON: object`, observed alongside the flaky mocked test, causal link
   unconfirmed) rather than chasing the root cause further — out of scope
   for this build-loop iteration.
5. Committed on `test/rf005-participant-identity-segregation`, merged
   `--no-ff` into `feature/docker-e2e-backend-integration` (`f135e396`),
   pushed both branches.
6. Filed **#368** (migrate the ~20 other `Patient`-field consumers off it,
   plus the RNF007 AC#4/AC#5 authorized/audited re-identification flow and
   encryption at rest for the segregated collection) as the follow-up for
   the deferred scope, flagged for `divide-and-conquer`.
7. Closed **#363** with a comment summarizing what landed vs. #368's scope.
8. `wrap-up` audit: product source touched is in-scope for `build-loop`
   (unlike `test-loop`). Filed **#369** for the pre-existing audit-log
   flood / mocked-test flakiness noticed this session.

## Repo state

- `feature/docker-e2e-backend-integration`: at `f135e396`, working tree
  clean, pushed. Carries the `ParticipantIdentity` entity + read-path
  segregation on `GET /api/patients/:id`.
- **#363 closed**, referencing follow-up **#368** (open, not started —
  scope explicitly flagged as possibly needing `divide-and-conquer`) and
  **#369** (open, unrelated pre-existing flakiness/log-flood, not started).
- Dev stack (`compose.yml`, not `compose.test.yml`) still up from prior
  sessions, not torn down. Backend runs via `nodemon --legacy-watch`
  (`compose.dev.yml`) so source edits hot-reload without a manual rebuild.
  Direct-Mongo e2e specs against it need `E2E_MONGO_URI`/`E2E_MONGO_DB`
  set explicitly (dev-stack creds/db, see `.env.docker`) — the helpers'
  defaults target the test stack.

## Recommended next steps

None queued explicitly by Dennis beyond "prereqs of Wave 2." Remaining
Wave 2 red-first prerequisites per `E2E_TRACEABILITY_PLAN.md`: **#364**/
**#365** (from #328), **#366** (RF022 bootstrap build, from #329), **#367**
(RF028 importer build, from #330), and now **#368** (RF005 storage
migration + re-id flow, from this session) — separate, smaller
build-loop/fix-bugs candidates once someone picks them up. **#369** (log
flood / flaky mocked test) is unrelated infra hygiene, not part of the
Wave 2 e2e traceability work. No further red-first e2e gaps are queued
unless the traceability plan names another RF beyond RF005/RF022/RF028
for Wave 2.

## Which skills to use

`fix-bugs` or a small `build-loop` pass for #364/#365/#366/#367/#368 once
picked up — all are narrow, already-scoped gaps, not full-requirement
builds; #366, #367, and #368 in particular should open with a
`divide-and-conquer` pass rather than assume one iteration. #369 is a
plain `fix-bugs` candidate (root-cause the canonicalization failure) once
someone wants to spend the time reproducing it deliberately. Another
`ship-integration-branch` pass once Wave 2's red-first prerequisites and
any build-loop follow-ups are done.
