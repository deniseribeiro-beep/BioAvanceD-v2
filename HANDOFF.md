# HANDOFF

**Written:** 2026-07-31, a `build-loop` session closing out **#328**
(RF010 ConsentTemplate/Consent split, Wave 2 red-first prerequisite) on
`feature/docker-e2e-backend-integration`, picked up directly from Dennis
after the prior #327 close-out — Docker was already on for this session.

## What happened this session

1. Routed via `work-issue` → `build-loop`: #328 asks for the first
   real-backend e2e test proving RF010's ConsentTemplate/Consent split
   gap, expected to fail against `main` — a missing capability, not a
   product bug or existing-code coverage gap.
2. Scoped the gap against `dict-07_ALINHAMENTO_CODIGO.md` row 3 and
   `dict-02_DICIONARIO.md` ELM-0088: the target model requires each
   Consent to carry an explicit `consentId` distinct from Mongo `_id`.
   Confirmed in code that `PatientConsentModel`/`consent.service.js`
   never assign one — only `_id` is ever exposed. Also included the
   issue's called-out cross-cutting RNF018 assertion (422 on malformed
   payloads) in the same spec, since `consent.controller.js` always
   responds 400 on validation failure — a repo-wide grep found zero uses
   of status 422 anywhere in `api/backend/src`.
3. Added a new `test.describe` block to `tests/e2e/tcle-dinamico.spec.ts`
   (real-backend, `PLAYWRIGHT_API_BASE_URL`-gated, same pattern as
   `intake-wizard.spec.ts`'s #327 block): AC#2 asserts a created consent's
   response/document carries a truthy `consentId` distinct from `_id`
   (**confirmed red** — response has no such field); RNF018 asserts a
   malformed payload returns 422 (**confirmed red** — returns 400).
4. Hit two known dev-stack gotchas while proving red, both already
   documented in `docker-workflow`'s `local-env/BioAvanceD-v2.md`: Mongo
   auth (needed `E2E_MONGO_URI` with `.env.docker`'s
   `MONGO_ROOT_PASSWORD`, `E2E_MONGO_DB=bioavanced_dev`) and an
   undocumented one — `consent.service.js`'s `normalizeSignaturePayload`
   always sets empty-string `signatureName`/`signatureImageBase64`, which
   then fails the Ajv schema's `minLength: 1` even though those fields
   aren't in `required` — so a valid signature payload is needed on
   every consent-creation request, not just signature-specific tests.
   Filed as `dyeallpies-skills-pack#158` for `playwright-specs` to
   encode this.
5. Verified the pre-existing failing test in the same spec file
   ("creating a template posts the filled-in metadata") predates this
   branch (reproduced on `git stash` before any edit) — not a regression
   from this session's change.
6. Committed on `test/rf010-consent-consentid-red`, merged `--no-ff` into
   `feature/docker-e2e-backend-integration` (`28ca545e`), pushed.
7. Filed **#364** (assign an explicit `consentId`) and **#365**
   (400-vs-422 validation status, flagged as likely cross-cutting beyond
   consent) as separate follow-ups per #328's own divide-and-conquer
   note — two independent sub-gaps, not one bundled fix.
8. Closed **#328** with a comment summarizing both red assertions and
   linking #364/#365.
9. `wrap-up` audit: only `tests/e2e/tcle-dinamico.spec.ts` touched (in
   scope for `build-loop`'s "test first" step, no product code edited —
   the fixes are #364/#365's scope). One new skill-pack finding filed
   (#158 above); no other friction.

## Repo state

- `feature/docker-e2e-backend-integration`: at `28ca545e`, working tree
  clean, pushed. Carries the new RF010/RNF018 red-first spec.
- **#328 closed**, referencing follow-ups **#364** (consentId model
  change, open, not started) and **#365** (400-vs-422 validation
  convention, open, not started — scope explicitly flagged as possibly
  wider than consent alone).
- Dev stack (`compose:up`) was already up this session and left
  running — not torn down, per Dennis's "Docker is on" for the session.

## Recommended next steps

None queued explicitly by Dennis beyond "prereqs of Wave 2." The
remaining Wave 2 red-first prerequisites per `E2E_TRACEABILITY_PLAN.md`
are still open: **#329** (RF022 Foundation Data Pipeline,
`pipeline-continuity.spec.ts`, blocks RF029/Wave 3), **#330** (RF028
Fase 2 importers, same spec file, also blocks RF029). **#363**
(ParticipantIdentity model/migration, from #327) and now **#364**/**#365**
(from this session) are separate, smaller build-loop/fix-bugs candidates
once someone picks them up — #365 in particular may be worth a
`divide-and-conquer` pass if it turns out to span more than
`consent.controller.js`.

## Which skills to use

`work-issue` → `build-loop` for #329/#330 (same red-first shape as
#327/#328). `fix-bugs` or a small `build-loop` pass for #364/#365 once
picked up — both are narrow, already-scoped gaps, not full-requirement
builds. Another `ship-integration-branch` pass once Wave 2's red-first
prerequisites and any build-loop follow-ups are done.
