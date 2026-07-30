# HANDOFF

**Written:** 2026-07-30, a same-day continuation session on
`feature/docker-e2e-backend-integration`. Ran `build-loop` on **#357**
(third link in the #355→#356→#357→#358 chain split from #354) and
closed it.

## What happened this session

1. Read #357's scope: decide whether `clinical-unit.routes.js` (the
   `clinicalUnits` collection CRUD/search surface at `/api/clinical-units`)
   should proxy to `organizations` or be retired outright, now that
   #355/#356 settled `clinicalUnitId`/`clinicalUnit` resolution.
2. Investigated and found retirement was the clear call, not proxying:
   - `patient.service.js`'s `resolveClinicalUnitSnapshot` has resolved
     exclusively against `organizations` since #353 — grepped the whole
     backend `src/` and confirmed `clinical-unit.routes.js` was the
     **only** code anywhere still reading/writing the `clinicalUnits`
     collection.
   - `migrateClinicalUnitOrganizations.js`'s own docblock states it's
     "Pré-requisito para retirar a coleção/rotas legadas de clinicalUnits
     (#352)" — the codebase already expected this retirement.
   - On the frontend, `clinicalUnitService` (services/api.ts) and the
     `useClinicalUnits` hook that called it were themselves **dead
     code** — grepped and confirmed no component ever imported the hook.
3. Implemented on `test/clinical-unit-routes-retirement`:
   - Wrote `clinical-unit.routes.retirement.test.js` first (asserting
     GET/GET search/POST `/api/clinical-units` all now 404), confirmed
     it failed (401, route still live) before making any change.
   - Unmounted the route in `app.js`, deleted
     `clinical-unit.routes.js`, deleted its two old integration test
     files (`clinical-unit.api.test.js`,
     `clinical-unit.routes.gaps.test.js`) since they tested behavior
     that no longer exists.
   - Deleted the frontend's dead `useClinicalUnits.ts` hook, the
     `clinicalUnitService` block in `services/api.ts`, and the
     now-unused `ClinicalUnit` type in `types/models.ts`. Verified with
     `tsc --noEmit` — clean.
   - Updated `docs/architecture/canonical-data-contract-v1.md`'s
     `clinicalUnitId` entry to record the #357 retirement decision,
     closing out the #355→#356→#357 chain's doc trail.
4. Verified: targeted vitest run green (4 files, 18 tests), frontend
   `tsc --noEmit` clean. No full-suite run this iteration per the
   end-loaded gate order.
5. Committed on `test/clinical-unit-routes-retirement`, merged into
   `feature/docker-e2e-backend-integration`, deleted the merged branch.
   Closed **#357**.
6. Ran `wrap-up`: no friction to report this iteration.

## Repo state

- `feature/docker-e2e-backend-integration` has one new merge commit
  (this session's `test/clinical-unit-routes-retirement`) on top of
  prior HEAD (`b5f6dad6`), not yet pushed — ahead of
  `origin/feature/docker-e2e-backend-integration` by several local
  commits (nothing pushed this session).
- Docker dev stack: **down**, unchanged for several sessions running
  now — this iteration used native-only vitest proof (no live backend
  needed for a route-removal + dead-code-removal slice). A future
  session bringing it up fresh still hits #344 (no admin user), #342
  (`--wait` healthcheck), and the frontend-container manual-start
  quirk.
- `test/e2e-real-backend-foundation` — still not deleted, still safe to
  delete (fully merged forward), Dennis hasn't confirmed.
- **#357 closed** (decision: retire outright, not proxy — regression-
  tested, docs updated). **#354 open**, tracking issue for the #353
  remainder, chain now at **#358** only — #358 is next, unblocked by
  #357's close. **#340, #341 open**, still blocked (transitively on
  #358). **#342, #344, #345 open** (infra findings, `test-branch`-
  labeled, non-blocking, unchanged). **#349, #350 open** (from the #347
  session, unrelated). **#336** (FHIR legacy reconciliation) still
  open, unrelated, non-blocking.
- Skills-pack: **#151 open** (documentation), build-loop real-backend
  proof-bar ambiguity for this repo — not blocking, informational; not
  leaned on directly this session (no service/query-logic slice this
  time, just route removal).

## Recommended next steps

None queued explicitly by Dennis. **#358** (last link in the
#355→#356→#357→#358 chain split from #354) is the natural next
`build-loop` iteration — it's now unblocked. Once #358 lands, #354
itself (the tracking issue for the whole #353 remainder) should be
revisited to see if it can close.

## Which skills to use

`build-loop` for #358 if picked up next — read its BioAvanceD-v2
overlay for the "real backend" proof-bar nuance (native-only mocks
suffice for a backend-internal slice; literal Docker is reserved for
the RF milestone's own e2e specs and `ship-integration-branch`).
`ship-integration-branch` only once the full #346→#347→#348/#351/#352/
#353→(#355→#356→#357→#358) wave is landed and Dennis explicitly asks to
graduate to `main`.
