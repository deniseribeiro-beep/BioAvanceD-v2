# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue 557" (following the prior handoff's top candidate).

## What happened this session

Continued #557 ("apply #556's live-download + license-verification pattern
to the remaining Fase 2 sources") via `build-loop`, picking up the first
member of §7.4 step 5: **HGNC**.

- Confirmed §7.4's "Ordem recomendada da Fase 2" order directly (`docs/
  docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md`, not the
  architecture-doc paraphrase) — step 5 is "Importar HGNC e relações
  gene-fenótipo/doença", right after the now-fully-landed step-4 group.
- Read `dict-01_FONTES.md`'s SRC_HGNC row directly: URL oficial
  `https://www.genenames.org/`, API `https://www.genenames.org/help/rest/`,
  Autenticação "Não ou conforme endpoint" (no auth, or per-endpoint) —
  unlike OMIM's row, this one's auth note turned out to be accurate as
  stated, not a red herring.
- Confirmed live (curl, 2026-08-13) that `rest.genenames.org/info` is a
  genuinely public, unauthenticated JSON endpoint — but **only when the
  request sends an explicit `Accept: application/json` header**; without
  one (or with GitHub's `application/vnd.github+json`, which
  `fetchJson`'s prior hardcoded default sent) it silently 200s with an XML
  body instead, which would have broken `response.json()` non-obviously.
  Generalized `fetchJson` in `fetchLiveRelease.js` to accept an optional
  `headers` override rather than special-casing HGNC around it.
- **HGNC has no discrete release/tag/edition at all**, unlike every prior
  source in this group — it's a continuously-updated dataset (dict-01's
  own "Atualização" value for this row is "Contínua"). The REST `/info`
  endpoint confirms this directly: it reports a live `lastModified`
  timestamp and a `numDoc` record count, not a version string. This is
  the first Fase 2 source needing a "release" signal that isn't a
  tag/redirect-target/edition-in-page-body — a sixth `verify-live-release
  .js` shape.
- **Added a sixth `kind`**: `'rest-info'` (`verifyRestInfo`) — fetches the
  JSON info endpoint with the required `Accept` header, treats a truthy
  `lastModified` as the release-presence signal, and checks a license
  pointer the same way every other shape does.
- License lives on genenames.org's own "About" page
  (`https://www.genenames.org/about/`), in a "Data release policy"
  section reading "No restrictions are imposed on access to, or use of,
  the data provided by the HGNC" — no separate LICENSE file, PDF, or
  CC-style badge the way HPO/MONDO/ORPHA have.
- Added the `HGNC` entry (`kind`/`infoUrl`/`licenseUrl`/
  `expectedLicensePointer`) to `liveVerifySources.js`, the
  `reference:live-verify:hgnc` npm script, and three new mocked-fetch
  unit tests (verified / missing-`lastModified` / missing-license-pointer)
  — the mock also asserts the `Accept: application/json` header is
  actually sent, not just that some fetch happened.
- **Ran `npm run reference:live-verify:hgnc` natively** — reports
  `status: "verified"`, exit code 0. Also re-ran
  `reference:live-verify:hpo/mondo/orpha/icd11/icd10/omim` natively as
  regression checks on the twice-more-refactored `fetchLiveRelease.js`/
  `verify-live-release.js` — all six still report their expected status
  (`"verified"` ×5, `"not-verifiable"` for OMIM).
- No changes needed to the arch tests or the CI workflow — same
  directory-wide arch-test/`workflow_dispatch` precedent as every prior
  #557 slice.
- Did **not** touch `src/reference-data/reference-imports/sources/hgnc.js`
  (the fixture source config, already built in #549) — same boundary
  precedent as every prior #557 slice.

Verified: 60/60 architecture tests (native, `node --test` via
`npm run test:architecture`, unchanged count), 125/125 unit tests across
`tests/unit/reference-imports/` (vitest, up from 122 — the 3 new HGNC
cases), lint (383 files) clean, all seven live-verify scripts (HGNC,
HPO/MONDO/ORPHA/ICD11/ICD10/OMIM regression) run natively against their
real upstreams.

Own branch `test/557-live-verify-hgnc` (same `test/<slug>` fallback as
every prior #557 slice), committed, merged (no-ff) into
`feature/docker-e2e-backend-integration`, pushed (`05ced419`), local
branch deleted (never pushed to remote, so no remote delete needed).
**#557 left open** with an updated progress comment (7 of ~15-16 done —
HPO, MONDO, ORPHA, ICD-11, ICD-10, OMIM, HGNC; ~9 remain) — not closed,
since the issue covers all Fase 2 sources and only one landed this
session. Same count-discrepancy caveat as the prior comment carried
forward unchanged (not re-litigated this session).

`wrap-up` filed one issue: **dyeallpies-skills-pack#268** — running
architecture tests natively via a bare `node --test tests/architecture/`
(directory arg) fails with `MODULE_NOT_FOUND` in this session's
Windows/Git-Bash environment; the repo's own `npm run test:architecture`
(a quoted recursive glob) works. No skill currently documents which form
to use, so a future session is likely to repeat the same first-guess
retry. Filed with a suggested doc line and a note that it's unconfirmed
whether this is Windows-specific or general Node `--test` behavior.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `05ced419`, clean,
  pushed, up to date with origin. Carries #555/#556's live-verify
  infrastructure + HPO pilot + MONDO + ORPHA + ICD-11 + ICD-10 + OMIM
  (prior sessions) + this session's HGNC slice and the sixth-`kind`-
  generalized `verify-live-release.js`/`fetchLiveRelease.js`, on top of
  #549's full 16-source Fase 2 fixture-import group.
- Issues this session: **none closed**. **#557 open**, progress comment
  added (HPO/MONDO/ORPHA/ICD-11/ICD-10/OMIM/HGNC done; same count
  discrepancy flagged inline, carried from the prior comment). **#550
  open** (tracking issue for the original 3-way split, unchanged).
  **dyeallpies-skills-pack#268 opened** (pack-repo tracker, the
  `node --test` directory-arg gotcha — see above).
- Docker: not used this session — live-verify is a network-only script,
  no Mongo/Docker involved, same as every prior #557 slice.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from before — see earlier handoffs for the full list;
  not re-enumerated here to avoid drift from a list nobody re-verified
  this session either).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
`handoff`'s own rule, nothing is queued.

Candidates carried forward:

- **#557** — continue the live-verify pattern for the next source. §7.4
  step 6 is "Importar LOINC e UCUM" — LOINC is the natural next pick
  (confirmed via `docs/docs-7-31-2026/3-Plano_Integrado_Foundation_Data_
  Pipeline.md` directly this session, not re-checked further ahead).
  Remaining, by name: LOINC, UCUM, DCB, ATC, DUO, Uberon, NCBI Taxonomy,
  Cell Ontology, EDAM. Per this session's confirmed pattern: (1) check
  §7.4 for the recommended order, (2) read `dict-01_FONTES.md`'s row for
  the source's stated distribution channel, (3) for a nominally gated
  source, check whether the authority's public website exposes the
  release/license signal unauthenticated before assuming the
  `'not-live-verifiable'` carve-out, (4) don't assume the release signal
  is always a tag/redirect/edition — HGNC's continuously-updated,
  no-version-string shape was a genuine sixth case; check what the live
  API/page actually reports before picking a `kind`. dict-01's SRC_LOINC
  row auth note is "Cadastro/chave conforme acesso" (registration/key per
  access) — check for a public unauthenticated surface the same way
  ICD-11/HGNC's rows turned out more open than their auth note implied,
  but don't assume it either — LOINC's registration wall may be real
  (unlike HGNC's, which turned out to be inaccurate/outdated for the
  REST API specifically).
- **#550** — stays open as the tracking issue for the original split
  until #557 fully lands.
- **#551** — full AC7 lifecycle (checkpoint/resume, quarantine recovery,
  rollback). Unchanged, still open.
- **#552** — Neo4j outbox projection (AC9) for TerminologyConcept/
  TerminologyRelation. Unchanged, still open.
- **#553** — compose.dev.yml's "14 Fase 2 sources" comments undercount the
  real total (16). Unchanged, still open, still a quick win — also the
  likely fix point for #557's own running-count miscount (see above).
- **#554** — #550's own title has the same "14" undercount #553 flagged.
  Unchanged, still open, still a quick win.
- **#530** — `dictionary:validate` isn't wired into `ci-pipeline.yml`.
  Unrelated to the RF028 cluster, still open.
- **#489** — full-suite vitest flakiness (JWT/encryption-secret failure
  shape, ~89 files), open, not re-confirmed.
- **#336** — still open: is `import.controller.js#importFhirBundle` dead
  code to remove, or does something still call it?
- Older backlog, unchanged: `#371`/`#374`/`#378`/`#379`, `#368`, `#345`,
  `#341`/`#340`, `#334`, `#331`/`#326`/`#325`, `#321`, `#319`, `#286`,
  `#284`, `#283`, `#282`, `#228`, `#115`, next e2e slice per
  `E2E_TRACEABILITY_PLAN.md`.
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263/#265/#267/#268**
  — pack-repo only, low priority except #268 (this session's new find),
  unchanged otherwise this session. (#266 is resolved by #267; #267/#268
  are the pack maintainer's call, not this repo's.)

## Dev stack state

Not brought up this session — no Docker/database-dependent code touched.
Same state as the prior handoff left it: torn down, named volumes
(mongodb/neo4j data) untouched, images cached.

## Which skills to use

- `build-loop`'s "check spec docs for recommended order" and "check the
  authority's public website before assuming a carve-out" guidance both
  paid off again this session — the second one this time resolving
  *positively* (HGNC's auth note turned out accurate: genuinely open),
  the opposite of OMIM's negative result last session. Confirms the
  handoff's own repeated point: check fresh every time, don't assume from
  the immediately-prior source's outcome either way.
- New pattern this session: **not every source's "release" signal is a
  tag, redirect target, or edition string** — HGNC is a continuously-
  updated dataset with no version identifier at all, so the live-verify
  signal became "does the info endpoint report a live timestamp" instead.
  Check what the authority's actual API/page reports before assuming one
  of the five prior `kind` shapes fits; a sixth (`'rest-info'`) was
  needed here and a future source may need a seventh.
- New pattern this session: **a generic-sounding fetch helper
  (`fetchJson`) can carry a hidden bias from its first caller** —
  `fetchJson`'s hardcoded `Accept: application/vnd.github+json` header
  (originally written for HPO/MONDO's GitHub-only use) silently broke
  HGNC's REST API, which returns XML instead of JSON without an explicit
  `Accept: application/json`. Generalized to take an optional `headers`
  override rather than adding a HGNC-specific fetch function — check
  whether an existing "generic" helper actually is generic before reusing
  it for a new source's differently-shaped upstream.
- Confirmed again this session: `.claude/skills/build-loop/local-env/`
  overlay files are junctions into the skills-pack clone — file an issue
  against the pack repo (`DyeAllPies/dyeallpies-skills-pack`, found via
  the sibling checkout's `git remote -v`, not guessed) with exact
  replacement text rather than editing directly. Also confirmed the same
  for `bioavanced-v2-testing-conventions`/`unit-test-loop` when filing
  #268 this session — `gh issue create` requires at least one `--label`
  on this pack repo (a committed hook enforces it), unlike this repo's
  issue filing.
