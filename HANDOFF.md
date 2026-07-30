# HANDOFF

**Written:** 2026-07-30, a continuation session on
`feature/docker-e2e-backend-integration`, picking up right where the
prior session's HANDOFF left off — #343 (Organization entity,
foundational for institutional-scope enforcement) needed a
`divide-and-conquer` pass and a product call with Dennis before it was
pickup-ready.

## What happened this session

1. Discussed the #343 migration approach with Dennis: since no
   production deployment exists yet, he confirmed a **hard cutover**
   (no legacy-alias/dual-write transition period) for migrating
   `User.institution`/`institutionalScope` off free text — contrast
   with the dictionary's own `institutionLegacy` guidance, which is
   aimed at post-deployment migrations, not pre-launch ones.
2. Ran `divide-and-conquer` on #343 per that product call. Checked dev/
   test fixtures first: only one Playwright spec
   (`tests/e2e/auth-access-security.spec.ts`) references
   `institution`/`institutionalScope`, so no broad fixture-preservation
   concern. No project board in this repo (no `local-env` overlay), so
   no boarding step.
3. Filed the split, confirmed with Dennis before filing:
   - **#346** — Organization entity (foundational: model/collection +
     create/seed path per dict-02 ELM-0024..0031 fields —
     `organizationId`, `officialName`, `acronym`, `organizationType`,
     `countryCode`, `website`, `contact`, `qualityStandards`).
   - **#347** — depends on #346. User migration: one-time script
     resolving+deduping distinct `institution`/`institutionalScope`
     strings into `Organization` docs, rewriting `User` to
     `organizationId`/`organizationIds`, dropping the old string
     fields (hard cutover, no back-compat read path). Also lists the
     other `institution`/`clinicalUnit` consumers found via grep
     (13 files) to audit, and flags the one Playwright spec to update.
   - **#348** — depends on #346. Sample/Patient reference wiring:
     `Sample.collectionSite` (new field, `Reference(Organization)` per
     ELM-0128) and upgrading `Patient.clinicalUnitId` from its current
     free-text/`clinicalUnits`-collection lookup to a real
     `Organization` reference.
4. Re-pointed **#340/#341** (institutional-scope enforcement, already
   filed from the prior session) from depending on #343 to depending on
   #348 — they need real reference fields to filter on, which #348
   delivers (not just the entity from #346, and not the User-side
   migration from #347).
5. Closed **#343** as the tracking issue, comment lists #346/#347/#348
   by number and notes #340/#341 were re-pointed to #348. No code
   shipped against #343 itself, consistent with last session's note
   that it was closed against a documented-requirement deliverable.

## Repo state

- `feature/docker-e2e-backend-integration` unchanged — this session
  shipped no commits, only issue triage/splitting (same as the prior
  session). Nothing to push.
- Docker dev stack status not re-verified this session — per the prior
  HANDOFF it was left **running** with a manually-bootstrapped
  `admin`/`Admin@123` account in `bioavanced_dev` Mongo (in-memory/
  volume-only, from the #344 workaround). Check with `docker ps` /
  `npm run compose:down` before assuming it's still up.
- `test/e2e-real-backend-foundation` — still not deleted; Dennis hasn't
  confirmed yet, still safe to delete (fully merged forward).
- **#343 closed** this session (tracking issue, no code). **#346, #347,
  #348 open** — the actual foundational/migration/wiring split, in that
  dependency order. **#340, #341 open**, re-pointed to depend on #348.
  **#342, #344, #345 open** (findings from the prior session, all
  `test-branch`-labeled, none blocking). **#336** (FHIR legacy
  reconciliation) still open, unrelated, non-blocking.

## Recommended next steps

#346 (Organization entity) is genuinely pickup-ready now — no further
product call needed, the field list comes straight from the dictionary.
It's the natural next `build-loop` iteration. #347 and #348 both depend
on it and shouldn't start first.

## Which skills to use

`build-loop` for #346 once picked up (spec exists in dict-02_
DICIONARIO.md, code doesn't yet). `ship-integration-branch` only once
Wave 2 is fully landed and Dennis explicitly asks to graduate to `main`.
