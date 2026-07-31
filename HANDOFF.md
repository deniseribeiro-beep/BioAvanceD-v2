# HANDOFF

**Written:** 2026-07-31, a `build-loop` session closing out **#327**
(RF005/RNF007 ParticipantIdentity segregation, Wave 2 red-first
prerequisite) on `feature/docker-e2e-backend-integration`, picked up
directly from Dennis after the prior session's #361 close-out — Docker
was already on for this session.

## What happened this session

1. Routed via `work-issue` → `build-loop`: #327 asks for the first
   real-backend e2e test proving RF005/RNF007's `ParticipantIdentity`
   segregation gap, expected to fail against `main` — a missing
   capability, not a product bug or existing-code coverage gap.
2. Confirmed the gap directly in code: `Patient.js:55-56` keeps
   `patientName`/`birthDate` as plain fields on the Patient document;
   no `ParticipantIdentity` entity exists anywhere. Also confirmed
   `neo4jCanonicalProjection.service.js` never projects these fields
   today (only a pseudonymized `Donor.id` from `participantId`) — so
   RNF007 AC#3 already holds, unlike AC#1/AC#2.
3. Added a new `test.describe` block to `tests/e2e/intake-wizard.spec.ts`
   (real-backend, `PLAYWRIGHT_API_BASE_URL`-gated, same pattern as
   `specimen-quality-inventory.spec.ts`): AC#1/AC#2 asserts
   `GET /api/patients/:id` never returns `patientName`/`birthDate`/
   `identityDocument` directly (**confirmed red** against the running
   dev stack); AC#3 asserts the `graph_projection_outbox` Mongo
   collection never carries those fields for the participant
   (**confirmed green**, read directly against Mongo since no API
   route exists to inspect the outbox).
4. Ran the new tests against the already-running dev compose stack
   (`bioavanced-backend-1` etc., ports 3000/5173/27017) — no fresh
   `compose:up`/`docker:e2e` needed since Docker was already on.
   Verified `npx tsc --noEmit` clean, then the actual Playwright run:
   1 failed (the intended red), 1 passed.
5. Committed on `test/rf005-participant-identity-segregation`, merged
   `--no-ff` into `feature/docker-e2e-backend-integration`
   (`1d8875c3`), pushed.
6. Filed **#363** (this repo) for the actual `ParticipantIdentity`
   model/migration build, per #327's own "file the fix as a separate
   follow-up" instruction — scoped to the entity, access controls, and
   the stale `docs/architecture/canonical-data-contract-v1.md` (#128).
7. Closed **#327** with a comment summarizing the red/green split and
   linking #363.
8. `wrap-up` audit: no friction. Only `tests/e2e/intake-wizard.spec.ts`
   touched (in scope for `build-loop`'s "test first" step); no product
   code edited this iteration since turning AC#1/AC#2 green is #363's
   scope, not this one's.

## Repo state

- `feature/docker-e2e-backend-integration`: at `1d8875c3`, working tree
  clean, pushed. Carries the new RF005/RNF007 red-first spec.
- **#327 closed**, referencing follow-up **#363** (ParticipantIdentity
  model/migration, open, not yet started).
- Dev stack (`compose:up`, compose.yml+compose.dev.yml) was already up
  this session and left running — not torn down, per Dennis's
  "Docker is on" for the session.
- Standing pack-repo inventory unchanged: `dyeallpies-skills-pack#154`,
  `#155`, `#156` still open/unapplied (from prior sessions' local-env
  overlay findings — none of the three block this repo's work, just
  not yet landed in the pack).

## Recommended next steps

None queued explicitly by Dennis beyond "prereqs of Wave 2." The
remaining Wave 2 red-first prerequisites per `E2E_TRACEABILITY_PLAN.md`
are still open: **#328** (RF010 ConsentTemplate/Consent split,
`tcle-dinamico.spec.ts`), **#329** (RF022 Foundation Data Pipeline,
`pipeline-continuity.spec.ts`, blocks RF029/Wave 3), **#330** (RF028
Fase 2 importers, same spec file, also blocks RF029). #363 (this
session's ParticipantIdentity follow-up) is a separate, larger
build-loop/divide-and-conquer candidate once someone picks it up.

## Which skills to use

`work-issue` → `build-loop` for #328/#329/#330 (same red-first shape as
#327). `divide-and-conquer` proactively for #363 once started — it's
explicitly flagged as a likely multi-slice migration. Another
`ship-integration-branch` pass once Wave 2's red-first prerequisites and
any build-loop follow-ups are done.
