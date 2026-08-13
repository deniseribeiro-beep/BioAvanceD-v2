# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue 557" (following the prior handoff's top candidate).

## What happened this session

Continued #557 ("apply #556's live-download + license-verification pattern
to the remaining Fase 2 sources") via `build-loop`, picking up right after
the prior session's MONDO slice.

- Per `docs/docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md`
  §7.4 "Ordem recomendada da Fase 2", the next source after MONDO is
  **ORPHA** (step 4's "ORPHA, CID-11, CID-10 e OMIM" group).
- **Discovered ORPHA breaks the GitHub-releases-API shape** HPO/MONDO both
  happened to share (both are OBO Foundry ontologies on GitHub). Confirmed
  live via `curl` against `orphacode.org` (not GitHub at all, per
  `dict-01_FONTES.md`'s SRC_ORPHA row: "Download/API",
  `https://www.orphacode.org/pack-nomenclature/` /
  `https://api.orphacode.org/`): the Orphanet Nomenclature Pack is a
  stable, unversioned direct-download URL
  (`https://www.orphacode.org/data/packs/Orphanet_Nomenclature_Pack_EN.zip`,
  HEAD 200, `Last-Modified: Thu, 02 Jul 2026 07:06:46 GMT` as the only
  release-date signal) with the license stated on its own landing page
  ("CC BY 4.0 licence" linking `creativecommons.org/licenses/by/4.0`,
  matching `sources/orpha.js`'s fixture license exactly) rather than a
  separate `LICENSE` file.
- **Generalized `verify-live-release.js`** with a `kind` field on each
  `liveVerifySources.js` entry: `'github-release'` (default, HPO/MONDO's
  existing behavior, unchanged) vs. the new `'direct-download'` (ORPHA's
  shape — HEAD-check a stable asset URL, no releases API). Added
  `fetchHead()` to `fetchLiveRelease.js` for the HEAD check.
- Added the `ORPHA` entry to `liveVerifySources.js`, `reference:live-verify:orpha`
  npm script, 3 new mocked-fetch unit tests (verified/mismatch-asset/
  mismatch-license, mirroring the existing HPO/MONDO cases but exercising
  the new direct-download mock shape).
- **`npm run reference:live-verify:orpha` run natively end-to-end against
  the real orphacode.org upstream** — reports `status: "verified"`.
  Also re-ran `reference:live-verify:mondo` natively as a regression check
  on the refactored `verify-live-release.js` — still `"verified"`,
  confirming the `kind` branch didn't disturb the existing GitHub path.
- No changes needed to the arch tests or the CI workflow — same as MONDO's
  precedent, #555's directory-wide arch-test design and generic CLI
  already cover any new registry entry automatically.

Verified: 60/60 architecture tests (native, `node --test`, unchanged
count), 115/115 unit tests across `tests/unit/reference-imports/`
(vitest, up from 112 — the 3 new ORPHA cases), lint (383 files) clean,
both live-verify scripts (ORPHA, MONDO regression) run natively against
their real upstreams.

Own branch `test/557-live-verify-orpha` (no dedicated `build-loop` prefix
exists yet; used the `test/<slug>` fallback per the build-loop overlay,
same as MONDO's session), committed, merged (no-ff) into
`feature/docker-e2e-backend-integration`, pushed (`dcb1b75b`), local
branch deleted (never pushed to remote, so no remote delete needed).
**#557 left open** with a progress comment (2 of 15 done — HPO, MONDO,
ORPHA — 13 remain) — not closed, since the issue covers all 15 sources
and only one landed this session.

`wrap-up` surfaced one finding: the ORPHA slice required a judgment call
(generalizing `verify-live-release.js` with a `kind` field) that
`skills/build-loop/local-env/bioavanced-v2.md` doesn't yet document, and
flagged that CID-11/CID-10/OMIM (the rest of step 4's group) are
API-key-gated per `dict-01_FONTES.md` and won't fit either existing
`kind` as-is. Filed against the skills-pack tracker rather than edited
directly (Rule 0 — this session isn't a pack-repo session):
**dyeallpies-skills-pack#264**, asking for a bullet in the build-loop
overlay covering (1) confirm live distribution shape before assuming
`'github-release'`, (2) CID-11/CID-10/OMIM will need a third `kind` or a
documented "not live-verifiable without credentials" carve-out. No
BioAvanceD-v2-side issue needed — #557 already tracks the remaining
sources including that trio.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `dcb1b75b`, clean,
  pushed, up to date with origin. Carries #555/#556's live-verify
  infrastructure + HPO pilot + MONDO (prior session) + this session's
  ORPHA entry and the `kind`-generalized `verify-live-release.js`, on top
  of #549's full 16-source Fase 2 fixture-import group.
- Issues this session: **none closed**. **#557 open**, progress comment
  added (HPO/MONDO/ORPHA done, 13 sources remain: CID-11, CID-10, OMIM,
  HGNC, LOINC, UCUM, DCB, ATC, DUO, Uberon, NCBI Taxonomy, Cell Ontology,
  EDAM). **#550 open** (tracking issue for the original 3-way split,
  unchanged). **dyeallpies-skills-pack#264 opened** (pack-repo tracker,
  build-loop overlay gap — see above).
- Docker: not used this session — live-verify is a network-only script,
  no Mongo/Docker involved, same as HPO/MONDO precedent.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from before — see earlier handoffs for the full list;
  not re-enumerated here to avoid drift from a list nobody re-verified
  this session either).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
`handoff`'s own rule, nothing is queued.

Candidates carried forward:

- **#557** — continue the live-verify pattern for the next source in
  recommended order: **CID-11 (ICD-11)** (§7.4 step 4, same group as
  ORPHA/CID-10/OMIM — translate "CID" → "ICD" before grepping
  `dict-01_FONTES.md`, per the build-loop overlay's confirmed trap).
  **Known blocker before writing code:** per `dict-01_FONTES.md`'s
  SRC_ICD11 row, WHO's ICD-11 API requires OAuth/API key — confirm
  whether an unauthenticated live-check is possible at all (e.g. a public
  release-notes/version page) before assuming the existing
  `'github-release'`/`'direct-download'` `kind`s apply; may need a third
  `kind` or a documented "not live-verifiable without credentials"
  outcome for this source (see dyeallpies-skills-pack#264). CID-10 and
  OMIM in the same step-4 group have the same API-key-gated shape per the
  dictionary and will hit the identical question.
- **#550** — stays open as the tracking issue for the original split
  until #557 fully lands.
- **#551** — full AC7 lifecycle (checkpoint/resume, quarantine recovery,
  rollback). Unchanged, still open.
- **#552** — Neo4j outbox projection (AC9) for TerminologyConcept/
  TerminologyRelation. Unchanged, still open.
- **#553** — compose.dev.yml's "14 Fase 2 sources" comments undercount the
  real total (16). Unchanged, still open, still a quick win.
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
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263/#264**
  — pack-repo only, low priority except #264 (adds useful precedent for
  the very next #557 slice), unchanged otherwise this session.

## Dev stack state

Not brought up this session — no Docker/database-dependent code touched.
Same state as the prior handoff left it: torn down, named volumes
(mongodb/neo4j data) untouched, images cached.

## Which skills to use

- `build-loop`'s "check spec docs for recommended order before asking the
  user which sub-item to start with" guidance paid off again — §7.4 gave
  ORPHA as the unambiguous next pick after MONDO with no need to ask
  Dennis.
- **New lesson this session, not yet in the build-loop overlay** (filed as
  dyeallpies-skills-pack#264 rather than edited directly, per Rule 0):
  don't assume every remaining #557 source shares HPO/MONDO's
  GitHub-releases-API shape just because the first two happened to.
  Confirm each source's actual live distribution (curl/WebFetch against
  the real upstream, same discipline already used for license/asset
  details) before reusing a prior source's registry-entry shape verbatim.
- Confirmed pattern for future #557 sources, updated: (1) read the
  existing fixture source file in
  `src/reference-data/reference-imports/sources/<code>.js` for
  `systemUri`/`license`/`licenseUri`, (2) **check `dict-01_FONTES.md`'s
  row for the source's actual distribution channel first** — GitHub repo,
  direct-download URL, or an authenticated API — rather than assuming the
  GitHub shape, (3) for a GitHub-hosted source: `gh api
  repos/<org>/<repo>` for license auto-detection + `gh api
  repos/<org>/<repo>/releases/latest` for the asset list; for a
  direct-download source: `curl -I` the stable asset URL and `curl`/
  WebFetch the license-bearing page for the pointer phrase; for an
  API-key-gated source: unresolved as of this session, see #557's ORPHA
  comment and dyeallpies-skills-pack#264, (4) add the registry entry
  (with the right `kind`) + npm script + mocked unit tests + run the live
  script natively, re-running one already-landed source too as a
  regression check whenever `verify-live-release.js` itself changed.
