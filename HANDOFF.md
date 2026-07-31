# HANDOFF

**Written:** 2026-07-31, a `build-loop` iteration on
`feature/docker-e2e-backend-integration`, immediately following the
2026-07-31 #344 fix-bugs session.

## What happened this session

1. Picked up issue **#320** (Study/Protocol/Collection have no CRUD
   API — `#295`'s reference-integrity check for `Sample.studyId`/
   `protocolId`/`collectionId` could only be seeded directly in Mongo,
   never created through a real endpoint). Routed via `work-issue` →
   `build-loop` (spec'd capability missing from the code, not a
   deviation or a coverage gap).
2. Found `api/backend/src/interface/routes/master-data.routes.js`'s
   `createMasterDataRouter` factory already implements exactly this
   shape (generic list/get/create/update/delete over a Mongo
   collection + an id field + a validation model) and is already used
   for `sampleTypes`/`sampleOrigins`/`extractionProtocols`/
   `measurementUnits`/`qualityDescriptions`. Mounted three more uses of
   it in `api/backend/app.js`: `/api/studies`, `/api/protocols`,
   `/api/collections`, reusing the existing Phase-1 identity-only
   `StudyModel`/`ProtocolModel`/`CollectionModel` from `#295` (the
   models' own comments already scope them to "não o conjunto MIABIS
   completo" — Phase-1, not full field set — so building CRUD on top of
   them isn't expanding that prior scoping decision, just exposing it).
3. Wrote `tests/e2e/study-protocol-collection-crud.spec.ts` (real
   backend only, `PLAYWRIGHT_API_BASE_URL`-gated) proving
   create/list/get/update plus a 422 on missing required field and a
   404 on a nonexistent id, for all three entities.
4. Verified live: `npm run compose:up` (dev stack), `npm run
   compose:seed-admin` (no-op, admin already existed from a prior
   session's named volume), ran the new spec — 9/9 passed. Also
   re-ran the existing `specimen-quality-inventory.spec.ts` (RF004
   AC#3 linkage tests) to check for regressions — initially saw 13
   unrelated failures from a missing `E2E_MONGO_URI`/`E2E_MONGO_DB`
   env var (the dev stack's Mongo requires auth per `.env.docker`;
   `seedParticipant.ts`'s default assumes the no-auth test stack) — not
   caused by this session's change. Re-ran with the env vars set
   correctly: all 4 AC#3 linkage tests passed. Tore the stack down
   afterward (no `--volumes`, named volumes including Mongo left in
   place).
5. Branched `test/study-protocol-collection-crud` off the integration
   branch (no dedicated `build-loop` branch prefix exists yet — see
   `local-env/bioavanced-v2.md`'s prefix note, `test/<slug>` is the
   documented fallback), committed (`0f9537b7`, `Fixes #320`), merged
   `--no-ff` into `feature/docker-e2e-backend-integration` (merge
   commit `8091df3e`), pushed, deleted the branch local (remote branch
   was never pushed, only the integration branch).
6. Closed #320 with the merge commit hash in the comment.
7. Wrap-up audit: no scope creep (only `app.js` + the new spec file),
   no lazy fixes. One real friction point — filed
   `dyeallpies-skills-pack#153` (docker-workflow's `bioavanced-v2.md`
   overlay documents `E2E_MONGO_URI`/`E2E_MONGO_DB` for the
   `compose.test.yml` test stack but not for the `compose:up` dev
   stack, which needs different, auth-bearing credentials) — quoted
   the exact addition text for a pack session to apply verbatim
   (Rule 0: can't edit the installed skill junction directly).

## Repo state

- `feature/docker-e2e-backend-integration`: pushed to
  `origin/feature/docker-e2e-backend-integration` at `8091df3e`,
  working tree clean, no local commits pending.
- `test/study-protocol-collection-crud`: merged and deleted locally
  (was never pushed to origin, so no remote branch to clean up).
- Docker Desktop/WSL: stack torn down at session end via plain
  `docker compose down` (no `--volumes`) — the `bioavanced_*` named
  volumes (Mongo included) still exist and now also contain the three
  new `studies`/`protocols`/`collections` test documents this
  session's spec created (harmless, same pattern as prior sessions'
  fixture accumulation).
- `test/e2e-real-backend-foundation` — still not deleted, still safe to
  delete (fully merged forward), Dennis hasn't confirmed.
- **#320 closed** this session. Standing inventory: #359 sign-off flag
  unchanged from prior handoffs.
- Filed `dyeallpies-skills-pack#153` (docker-workflow overlay gap,
  documentation label) — not yet applied to the installed skill file;
  a future pack-repo session should pick it up.

## Recommended next steps

None queued explicitly by Dennis this session.

## Which skills to use

`work-issue` to route whichever open issue gets picked up next.
`ship-integration-branch` remains available if/when Dennis asks to
graduate `feature/docker-e2e-backend-integration` to `main`.
