# HANDOFF

**Written:** 2026-07-31, a `build-loop` session closing out **#367**
(RF028 reference-data importers, first Fase 2 pipeline slice) on
`feature/docker-e2e-backend-integration`, picked up directly from Dennis
right after the #366/#372 close-out.

## What happened this session

1. Routed via `work-issue` → `build-loop`: #367 asked for RF028's
   reference-data importer pipeline — `ReferenceDatasetRelease`,
   `ReferenceImportRun`, `ReferenceImportIssue`, `TerminologyConcept`,
   `TerminologyRelation` didn't exist anywhere in `api/backend/src`, and
   `pipeline-continuity.spec.ts`'s RF028 red-first block (from #330)
   proved the gap.
2. #367's own scope note flagged the full target (5 new models + 14
   external terminology sources, each needing streaming download/parse/
   validate/promote/rollback) as bigger than one iteration and
   recommended `divide-and-conquer`, same shape as #366/RF022. Asked
   Dennis via `AskUserQuestion` which source to build first — Dennis
   redirected to check the docs before guessing, which settled it:
   `3-Plano_Integrado_Foundation_Data_Pipeline.md` §7.4 "Ordem
   recomendada da Fase 2" explicitly names HPO as the first source (step
   2, right after registering sources). Also confirmed with Dennis:
   Neo4j outbox projection (AC 9) and full AC 7 lifecycle
   (checkpoint/resume/quarantine recovery/rollback) are both deferred to
   the follow-up; this slice proves dry-run + idempotency only.
3. Slice 1 (this session, landed): the 5 canonical models
   (`api/backend/src/models/`), a generic universal-pipeline runner
   (`api/backend/src/reference-data/reference-imports/pipeline.js` —
   Acquire/Integrity/Parse/Normalize/Stage/Validate/Approve/Promote/
   Verify, already reusable for the other 13 sources), and HPO wired
   end to end against a bundled fixture
   (`reference-imports/fixtures/hpo-sample.jsonl` — 8 valid concepts, 7
   `is_a` relations, 2 intentionally malformed rows proving
   `ReferenceImportIssue` recording). Wired into `compose.dev.yml` as a
   `reference-data-bootstrap` one-shot service, running after
   `foundation-bootstrap`. Also removed `hpo` from
   `import-large-reference-dataset.js`'s placeholder `allowedDatasets`
   set, since it graduated to its own operational script.
4. Verified against the real dev-stack backend: both RF028 red
   assertions in `pipeline-continuity.spec.ts` now pass. Confirmed
   idempotency by re-running the bootstrap service twice against the
   real dev-stack Mongo — second run correctly reported
   `idempotent: true`, zero duplicate docs (1 release, 8 concepts, 7
   relations, 1 run, 2 issues, confirmed via direct `mongosh` count).
   Full `pipeline-continuity.spec.ts` file green (RF022/RF023/RF028; RF029
   has no test yet — MISSING per the traceability matrix, Wave 3,
   unrelated to this slice). 48 new unit tests + 4 new
   architecture-boundary tests, all green.
5. Full targeted native suite (`tests/unit tests/integration
   tests/compliance tests/architecture`, 325 files, 6365 tests) surfaced
   one regression I introduced (`collections.test.js`'s hardcoded
   `DEFAULTS` list, fixed same session) and two **pre-existing, unrelated**
   failures — confirmed via `git stash` that both reproduce without this
   session's changes — filed rather than fixed:
   - **#375** — `test:architecture`'s `node --test` invocation can't
     parse the ESM-syntax arch test files (every file in
     `tests/architecture/` fails identically); this is a hard-gating CI
     step in `ci-pipeline.yml` that has **never actually run**, since
     `tests/architecture/` doesn't exist on `main` yet — will break the
     first PR that merges any of these branches. Not fixed here
     (unrelated to RF028).
   - **#376** — `patients.expanded.api.test.js`'s `GET /api/patients/:id`
     returns `patientName: undefined`. Not investigated further.
6. Committed on `test/rf028-hpo-importer-slice` (`a776e3f3`), merged
   `--no-ff` into `feature/docker-e2e-backend-integration` (`6d83bc4d`),
   pushed, deleted the slice branch.
7. Closed **#367** with a comment summarizing the landed slice and
   naming #373/#374 (RF028 follow-ups) and #375/#376 (unrelated findings)
   as separate tracked items.
8. `wrap-up` audit: filed **skills-pack#167** — build-loop's "Picking a
   slice" guidance doesn't say to check spec docs for an explicit
   recommended sequence before asking the user to pick among several
   roughly-equal sub-items (this session asked Dennis to pick a first
   RF028 source via `AskUserQuestion` before checking whether the docs
   already ordered them; they did, in §7.4). Proposed exact wording in
   the issue for a pack session to apply. No other friction; no scope
   creep; nothing else security-relevant (the new `ReferenceImportIssue.
   rawValue` field stores rejected-record payloads unencrypted, but
   RF028's domain is exclusively public reference ontologies, not
   patient/civil data, so the dictionary's own conditional
   encryption note doesn't currently bind — considered, not actioned).

## Repo state

- `feature/docker-e2e-backend-integration`: at `6d83bc4d`, working tree
  clean, pushed. Carries the RF028 HPO importer slice on top of #366's
  Foundation Data Pipeline bootstrap.
- **#367 closed.** #373 and #374 open (RF028 follow-ups, both
  `Depends on: #367`, satisfied — #374 additionally depends on #371,
  not yet landed). **#375 and #376 open** (pre-existing, unrelated —
  CI architecture-test breakage and a patients API test failure).
- Dev stack (`compose.yml` + `compose.dev.yml`) is currently **up** —
  brought up via `npm run compose:up` this session to verify the slice,
  admin seeded via `npm run compose:seed-admin`. Not torn down yet as of
  this writing; next session (or this one's `clean-up` pass) should
  decide whether to tear it down or hand it off running.

## Recommended next steps

None queued explicitly by Dennis. Candidates: **#373**/**#374** (RF028
follow-ups just filed, both already flagged `divide-and-conquer`-sized —
#373's suggested next chunk is MONDO, per §7.4 step 3, to prove
`pipeline.js`'s genericity with a second real source), **#375** (CI's
`test:architecture` step will hard-fail on the first PR to `main` —
worth fixing before any `ship-integration-branch` attempt), **#376**
(patients.expanded API test, needs a `fix-bugs` reproduction pass),
**#370**/**#371** (RF022 follow-ups from the #366 session, still open),
**#367**'s siblings from earlier sessions: **#368** (RF005 storage
migration), **#369** (flaky mocked test, unrelated infra hygiene). Not
this repo's concern: `dyeallpies-skills-pack#163`/`#164`/`#165` (from
the #366 session) and now `#167` (this session) are open in the
skills-pack tracker — a skills-pack session would pick those up, not a
BioAvanceD-v2 one.

## Which skills to use

`#370`/`#371`/`#373`/`#374` are already flagged for a `divide-and-conquer`
pass rather than assumed single-iteration. `#375` and `#376` are plain
`fix-bugs` candidates (root-cause each independently — they're unrelated
to each other and to RF028). Another `ship-integration-branch` pass once
Wave 2's red-first prerequisites and any further build-loop follow-ups
are done — but check **#375 first**, since it will otherwise fail that
pass's real CI signal on the very first PR.
