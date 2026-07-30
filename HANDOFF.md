# HANDOFF

**Written:** 2026-07-30, a `work-issue` → `build-loop` session closing #295
(RF004 AC#3, Study/Protocol/Collection linkage).

**Branch:** `test/e2e-real-backend-foundation`, now at `63a1c092`
(pushed, clean), 1 commit (merge) ahead of the prior handoff's `93800401`.

## What happened this session

1. Read the prior handoff — #318's integration-merge gate had two
   remaining items, #295 and #297, both described as code gaps rather
   than missing test coverage.
2. Routed #295 through `work-issue` → `build-loop`. The issue itself
   framed step 1 as an open design call ("full Study/Protocol/Collection
   models with CRUD, or cheaper validation against a reference list?")
   — but `docs/docs-7-27-2026/extracted/dict-02_DICIONARIO.md` (ELM-0039
   through ELM-0075) already settles it: Study/Protocol/Collection are
   documented as real entities with their own identity, referenced from
   Specimen via typed `Reference` fields (ELM-0118/0119), not a
   controlled vocabulary. Docs-first check caught this before treating
   it as a genuine open question.
3. Implemented the minimal Phase-1 slice: new `StudyModel`/
   `ProtocolModel`/`CollectionModel` (`api/backend/src/models/{Study,
   Protocol,Collection}.js` — identity fields only, not the full MIABIS
   set). Added optional `studyId`/`protocolId`/`collectionId` fields to
   `Sample.js`, additive alongside the existing free-text
   `linkedProject`/`protocolApplied`/`specimenCollection` (left
   untouched — renaming/repurposing them would have broken every
   existing fixture across the e2e suite that passes `linkedProject` as
   arbitrary text).
4. `sample.service.js`'s `createSample` now checks, only when a client
   supplies one of the three new fields, that it resolves to a real
   document in `studies`/`protocols`/`collections` (404 if not) —
   "quando aplicável" per the requirement text, not retroactive
   enforcement on the pre-existing fields.
5. Added e2e fixtures (`seedStudy`/`seedProtocol`/`seedCollectionEntity`
   in `tests/e2e/helpers/seedParticipant.ts`, same direct-Mongo-insert
   pattern as `seedOperationalLocation` — no CRUD API exists yet for any
   of the three) and 4 new tests in `specimen-quality-inventory.spec.ts`
   (new `#295` describe block): each of studyId/protocolId/collectionId
   rejected with 404 when it doesn't resolve, and one happy-path proving
   all three persist when they do. Ran the full spec file against the
   real compose stack: **21/21 passing** (17 pre-existing + 4 new, no
   regressions).
6. Docker was already confirmed on for the session (per user) but no
   containers were running — rebuilt `backend-app-test`/`worker-test`/
   `neo4j-projection-worker-test` with this session's changes baked in,
   brought the full stack up fresh.
7. Committed on `test/rf004-study-protocol-collection-linkage-295`,
   merged (`--no-ff`) into `test/e2e-real-backend-foundation`, deleted
   the slice branch, pushed. Closed #295 with the merge hash.
8. `wrap-up` audit: filed `deniseribeiro-beep/BioAvanceD-v2#320` — no
   CRUD API exists for Study/Protocol/Collection, so in the real product
   (outside test fixtures) there is currently no way for an operator to
   populate `studyId`/`protocolId`/`collectionId` on a sample at all;
   whether/how much CRUD surface these need is a separate product call,
   not something this slice should decide unilaterally. One process
   note: edited files before creating the slice branch (caught and fixed
   before the first commit — no lasting effect, but the branch-before-
   first-Edit step in `build-loop` needs to be front-of-mind even when a
   docs-lookup detour precedes the first Edit).

## Repo state

- `test/e2e-real-backend-foundation` at `63a1c092`, pushed, clean.
- **#295 closed** (RF004 AC#3, Study/Protocol/Collection linkage —
  proven against the real compose stack).
- The real compose test stack is currently **running** on this machine
  (rebuilt this session with this issue's changes baked in) — not torn
  down; next session should `docker compose --env-file .env.test.example
  -f compose.test.yml down --volumes --remove-orphans` if it doesn't
  need it, or reuse it if continuing e2e work immediately.
- **#290, #291, #292, #307, #314, #313, #302, #285, #304, #295** all
  closed.
- New this session: **`deniseribeiro-beep/BioAvanceD-v2#320`** (Study/
  Protocol/Collection CRUD-API gap, filed this session).
- Carried forward untouched, still open: **`dyeallpies-skills-pack#146`**
  (BioAvanceD-v2 local-env gap), **`deniseribeiro-beep/BioAvanceD-v2#319`**
  (`TEST_SUPPORT_SECRET` drift between `.env.test.example` and
  `compose.test.yml`), the possibly-undeleted remote
  `origin/fix/mongo-audit-repo-generate-movement-id`,
  `dyeallpies-skills-pack#141` (unassigned),
  `dyeallpies-skills-pack#144` (branch-deletion permission-classifier
  block). `test/close-environmental-excursion-301` (merged feature
  branch, still exists locally/remotely — safe to delete once confirmed
  no longer needed, not done this or prior sessions).
- **#297 still open**, per #318's checklist — the other remaining code
  gap (sample quantity updates not atomic). Not touched this session.
- **#115** still open, not actionable (Denise's decision already on
  record).
- **#293** still open, an implementation gap (no test-side TOTP
  generator), not a design call.
- **#228** open (coverage snapshot tracking issue, see
  `api/backend/COVERAGE_NOTES.md`).
- **#286, #283, #282, #284** untouched (frontend Docker flake, docs
  drift, CI Playwright wiring).
- Wave 1 of `E2E_TRACEABILITY_PLAN.md` remains fully closed. #318's
  integration-merge checklist now has **one** item left: #297.

## Recommended next steps

**#318's gate is down to #297** — the last remaining item before the
integration merge onto `feature/docker-e2e-backend-integration`. It's a
code gap (sample quantity updates not atomic), not missing tests, so
route it through `work-issue` — confirm against
`docs/docs-7-27-2026/extracted/` per #318's own checklist reasoning
before assuming the fix shape (same docs-first check this session used
for #295 caught a false "needs design call" framing — worth applying to
#297 too rather than trusting its own issue text at face value). Once it
closes, re-run `test:e2e:docker` against the merged tree per #318's
definition of done, then proceed with the integration merge (confirmed
fast-forward-clean as of two sessions ago — no divergent history to
reconcile, unless #297's fix touches files also changed upstream).

Also still outstanding from earlier handoffs: the real-backend e2e proof
for #314's `sensor-registration.spec.ts` fix has still not been re-run
against the real compose stack.

## Which skills to use

`work-issue` → `build-loop` is the right route for issues that name a
capability with existing test/unit scaffolding but no real-backend e2e
proof. #297 is described as a code gap (not missing proof) — check
whether it's `fix-bugs` shape before defaulting to `build-loop`, same
caution the prior handoff raised for #295/#297 both; #295 turned out to
still fit `build-loop` once the doc check resolved its "design call"
framing, but #297 may not.
