# HANDOFF

**Written:** 2026-08-17, same-day continuation session (third update).
User said "read handoff, pick the next group of issues to resolve.
Docker is on." Read the prior handoff, picked two candidates it had
already surfaced as unblocked/actionable (`#600`, `#601`), routed both
through `work-issue`, resolved both.

## What happened this session

**`#600`** ("compose.test.yml never wires the reference-data-bootstrap
chain — every RF022/RF028 pipeline-continuity real-backend test fails")
— **closed, no new work needed.** Cross-checked its specific claim (19
failures = 2 RF022 + 17 RF028) against `#374`'s closing comment from the
prior session (which this session confirmed via `gh api` — `#374`'s
close reported the exact same 17 RF028 + RF022/RF023/AC9 tests passing
23/23 against a live stack). `#600`'s own blocking condition ("leaving
this open until #374 lands") was satisfied; closed referencing `#374`,
no Docker/code work required.

**`#601`** ("RF011 FHIR bundle commit: re-querying findCommittedPatient
after a successful poll returns null") — **closed, real fix landed.**
The issue's own two candidate theories (re-query race vs. eventual-
consistency gap) were both wrong. Brought up `compose.test.yml`'s core
services + `admin-bootstrap-test` (targeted service list, so
`playwright-runner` never auto-started — true isolation from the first
command, no need to separately stop it). The failing test reproduced
**deterministically, 5/5**, even fully isolated — ruling out a race
immediately. Traced the real cause by inspecting the committed Mongo
documents directly (`mongosh` into `mongodb-test`): the `patients`
collection document has no `patientName` field at all —
`fhir-import-staging.service.js`'s `commitBatch` (lines 915-918) stopped
writing it there as of `#571`/`#575`'s civil-identity segregation; its
sole write target is the segregated `participantIdentities` collection
(confirmed: plaintext `patientName` present there, pending `#574`'s
future ciphertext-only cutover). The test was simply never updated —
classic stale-test, not a race, not a product bug.

Fix (branch `fix/601-rf011-committed-patient-name`, commit `448fe4ec`,
merged `25018517` on `feature/docker-e2e-backend-integration`, branch
deleted both sides): added `findCommittedParticipantIdentity()` to
`tests/e2e/helpers/queryFhirImport.ts`, pointed the assertion at the
right collection, extended `removeFhirImportFixtures()` to also clean up
`participantIdentities` (it wasn't being cleaned before, so committed
civil-identity fixtures were accumulating same as the already-documented
`mongodb-test-data` pattern). Verified: all 3 RF011 tests pass on the
merged tree, plus 5x isolated re-runs of the specific commit test with
no flake.

**Filed two new issues while tracing `#601`:**
- **`#603`** (BioAvanceD-v2): `patientService.getPatient()` — and
  therefore the `/api/patients/:id/reidentify` endpoint, RNF007
  AC#4/AC#5's Administrador-only reidentification path — 500s for any
  `participantId` that isn't the standard 8-digit internally-generated
  form. FHIR-imported participants (and any other non-numeric-id scheme)
  fall into a branch that assumes anything non-8-digit is a Mongo
  ObjectId, and `new ObjectId(...)` throws on FHIR-style ids. Reproduced
  directly against the live stack. Not a security hole (fails closed),
  but a genuine functional break in a compliance-relevant path — nobody
  can legitimately reidentify a FHIR-imported participant today.
- **`dyeallpies-skills-pack#324`**: `gh issue view/close/comment`
  (GraphQL-backed) hit sustained `HTTP 503`s this session while `gh api`
  (REST) to the same endpoints worked immediately — documented the
  fallback pattern (retry once or twice, then switch to `gh api`) for a
  future `resolve-issue` edit. Not fixed here per Rule 0 (skill files
  only editable from the pack repo).

**Docker teardown + cleanup done** at end of session: `docker compose
... down --remove-orphans` (named test-stack volumes left intact, no
images were built this session so nothing to `docker rmi`/prune),
`test-results/` debris from the pre-fix failed runs removed.

## Repo state

- On `feature/docker-e2e-backend-integration`, clean except the
  gitignored/junctioned `.claude/skills/` (untracked, not part of this
  session's diff). In sync with `origin` (pushed `25018517`).
- **Docker: engine reachable, stack torn down** (nothing queued needs it
  up). No containers running. Named test-stack volumes intact.

## Recommended next steps

None queued — the user hasn't named what's next. Candidates visible in
the backlog, not confirmed direction:
- **`#603`** — new this session: fix `getPatient()`'s id-shape branching
  so FHIR-imported (and other non-8-digit) participants can actually be
  reidentified. Small, well-scoped, has a working repro already in the
  issue body.
- **`#576`** — the UI slice: create/edit/delete forms for organizations
  and collections. No existing "master-data admin" UI pattern exists
  anywhere in the frontend to extend — genuinely new UI surface, likely
  its own `build-loop` iteration(s).
- **`#602`** — RBAC catalog `allowedActions` decorative-metadata gap;
  needs a design call on whether to enforce per-verb or correct/drop the
  metadata.
- **`#599`** — explicitly flagged in its own body as a repo-owner call
  (widen `ci-pipeline.yml`'s trigger to the integration branch); not
  mine to decide.
- **`#585`** — still Dennis's call (revive vs. retire
  `playwright-runner`); sole blocker for "wire RF028 into CI" (the piece
  `#374` deliberately left out, mirroring `#371`).
- **`#336`** — still needs Dennis's call (fix vs. retire the legacy
  `import.controller.js#importFhirBundle` endpoint); `#570` stays
  parked on it, unchanged.
- **`test/human-showcase-video`** — still awaiting Dennis's go to
  show/merge, unchanged.
- Skills-pack `#297`/`#294`/`#315`/`#317`/`#318`/`#321`/`#322`/`#323`/
  `#324` — `#324` is new this session (see above); rest unchanged, not
  checked.
- pack-repo `#279`/`#280`/`#281`/`#283`/`#248`/`#270`/`#286`/`#301`/
  `#309`/`#310`/`#311`/`#312`/`#313`/`#314` — unchanged, not checked
  this session.
