# HANDOFF

**Written:** 2026-07-30, a same-day continuation session on
`feature/docker-e2e-backend-integration`, picking up #353 (the
`clinicalUnits` service/controller/routes retirement split from #352).

## What happened this session

1. Ran `build-loop` on #353. Read its full scope: retire
   `patient.service.js`'s legacy ObjectId/name-based `clinicalUnits`
   lookup, `paciente.controller.js`'s allowlist, retire/proxy
   `clinical-unit.routes.js`, and rewrite the 8 dependent test files.
2. Applied `divide-and-conquer` immediately — both the issue and the
   #352 handoff already flagged this as too large. Scoped this
   iteration to `patient.service.js`'s `resolveClinicalUnitSnapshot`
   only: the core legacy read-path retirement, independently provable,
   and a genuine prerequisite (the controller/routes layers build on
   whatever shape this method settles on).
3. Implemented on `test/clinical-unit-service-retirement`:
   - Rewrote `resolveClinicalUnitSnapshot` in
     `api/backend/src/services/patient.service.js` to resolve
     `clinicalUnitId`/`clinicalUnit` exclusively against `organizations`
     (by `organizationId`, then by `OrganizationModel.normalizeName`'d
     `officialName`) — dropped the ObjectId-against-`clinicalUnits`
     lookup and the `clinicalUnits` name-based fallback entirely.
     Dropped the now-unused `ClinicalUnitModel` import, added
     `OrganizationModel`.
   - Note: unified two previously-distinct error messages
     (`clinicalUnitId inválido` vs `Unidade clínica não encontrada`)
     into one (`Unidade clínica não encontrada`), since the
     ObjectId-format-validity distinction no longer applies once ids
     are plain organization UUIDs. Minor externally-visible behavior
     change, not called out explicitly in #353 — flagged in this
     session's wrap-up, not filed separately (low risk, no known
     caller pattern-matches the message string).
   - Rewrote the 5 dependent unit test files that mocked the old
     `clinicalUnits`/`clinical_units` collection shape:
     `patient.service.gaps.unit.test.js`, `.gaps2`, `.gaps3`,
     `.encryption-clinicalunit.gaps.unit.test.js`,
     `.createUpdate.gaps.unit.test.js`.
   - Updated `docs/architecture/canonical-data-contract-v1.md`'s
     `clinicalUnitId` entry to describe the new resolve-only-via-
     Organization behavior and list what's still open.
4. Verified: targeted run of all 6 touched/dependent test files green
   (99/99), no full-suite run this iteration per the end-loaded gate
   order.
5. Committed on `test/clinical-unit-service-retirement`, merged into
   `feature/docker-e2e-backend-integration` (`fd6f5e84`), deleted the
   merged branch. Closed **#353** against the narrowed
   (service-layer-only) deliverable, per `divide-and-conquer`'s close
   discipline.
6. Filed **#354** (`test-branch` label) carrying the remainder of #353:
   `paciente.controller.js`'s allowlist, the free-text
   `clinicalUnit` search/filter paths in `patient.service.js`
   (`query.clinicalUnit` regex, `filters.clinicalUnit` exact match —
   still read/write `patients.clinicalUnit` directly, not yet decided
   whether that needs an Organization-based replacement),
   `clinical-unit.routes.js`'s proxy-or-retire decision, and the 3
   still-untouched test files (`patient.model.unit.test.js`,
   `paciente.controller.test.js`, `patients-integration.test.js`).

## Repo state

- `feature/docker-e2e-backend-integration` has one new merge commit
  (this session's `test/clinical-unit-service-retirement`) on top of
  prior HEAD (`07a53bbc`... now at `fd6f5e84`), not yet pushed — ahead
  of `origin/feature/docker-e2e-backend-integration` by 16 local
  commits (includes prior sessions' unpushed work too — nothing pushed
  this session or last).
- Docker dev stack: **down**, unchanged for several sessions running
  now — native tests only, per the end-loaded gate order. A future
  session bringing it up fresh still hits #344 (no admin user), #342
  (`--wait` healthcheck), and the frontend-container manual-start quirk.
- `test/e2e-real-backend-foundation` — still not deleted, still safe to
  delete (fully merged forward), Dennis hasn't confirmed.
- **#353 closed** this session (service-layer slice only), merged.
  **#354 open** (new this session — the controller allowlist, routes
  retirement, remaining search/filter design, and 3-file test rewrite,
  carried forward from #353). **#340, #341 open**, still blocked (now
  transitively on #354). **#342, #344, #345 open** (infra findings,
  `test-branch`-labeled, non-blocking, unchanged). **#349, #350 open**
  (from the #347 session, unrelated). **#336** (FHIR legacy
  reconciliation) still open, unrelated, non-blocking.

## Recommended next steps

None queued explicitly by Dennis. #354 (the controller/routes retirement
+ remaining test rewrites) is the natural next `build-loop` iteration if
continuing this wave — smaller than the original #353 but still touches
a live request-path (`paciente.controller.js`'s allowlist) and a
proxy-vs-retire architectural call for `clinical-unit.routes.js`; may
still warrant its own `divide-and-conquer` split (controller allowlist
first, routes decision second).

## Which skills to use

`build-loop` for #354 if picked up next.
`ship-integration-branch` only once the full #346→#347→#348/#351/#352/#353
(→#354) wave is landed and Dennis explicitly asks to graduate to `main`.
