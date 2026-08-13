# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue 557" (following the prior handoff's top candidate).

## What happened this session

Continued #557 ("apply #556's live-download + license-verification pattern
to the remaining Fase 2 sources") via `build-loop`, picking up right after
the prior session's ICD-11 slice with the next source in
`docs/docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md` §7.4's
"ORPHA, CID-11, CID-10 e OMIM" group: **ICD-10**.

- Confirmed the trap flagged in the prior handoff was real: per
  `dict-01_FONTES.md`'s SRC_ICD10 row, the "URL oficial"
  (`https://icd.who.int/browse10/2019/en`) is a **fixed-edition** browse
  page, not a "latest" redirect like ICD-11's. Live checks (curl,
  2026-08-13): the page 200s directly (no redirect; HEAD also works,
  unlike ICD-11's redirect target which 405s on HEAD), and the edition is
  embedded twice in static page markup — `<title>ICD-10 Version:2019</title>`
  and `oInfo.ontologyKey = "2019"` — rather than exposed via a redirect
  target, releases API, or Last-Modified header.
- **No ICD-10-specific license document was found live.** The browse page
  itself carries no license/copyright text; the one PDF it links (the
  Instruction Manual, `ICD10Volume2_en_2019.pdf`) is compressed, so
  `fetchText()`'s naive UTF-8 `.text()` decode — which worked for ICD-11's
  *uncompressed* license PDF — doesn't surface readable "World Health
  Organization" text from it. `dict-01_FONTES.md`'s SRC_ICD10 row itself
  only gives the generic "Termos WHO/edição nacional" with no
  source-specific license URL (unlike SRC_ICD11's dedicated PDF).
  Resolved by reusing **WHO's sitewide Terms of Use page**
  (`https://www.who.int/about/policies/terms-of-use`) as the
  license-bearing surface — confirmed live to contain the durable
  plain-text pointer "Copyright World Health Organization (WHO)" in
  actual prose (not just page `<meta>` tags). This is a second precedent
  (after #265's API-vs-public-website lesson) for not treating a missing
  source-specific license link as a dead end — check the authority's
  general/sitewide terms page before concluding a source can't be
  verified.
- **Added a fourth `kind` to `verify-live-release.js`**: `'fixed-edition'`
  (`verifyFixedEdition`) — GETs a stable, non-redirecting page URL,
  extracts the live edition via a regex against the page body, and
  compares it to the expected edition, alongside the existing
  `'github-release'` (HPO/MONDO), `'direct-download'` (ORPHA), and
  `'redirect-version'` (ICD-11) shapes.
- Added the `ICD10` entry to `liveVerifySources.js`, `reference:live-verify:icd10`
  npm script, 3 new mocked-fetch unit tests (verified/mismatch-edition/
  mismatch-license, mirroring the other three shapes' test structure).
- **`npm run reference:live-verify:icd10` run natively end-to-end against
  the real icd.who.int/who.int upstream** — reports `status: "verified"`.
  Also re-ran `reference:live-verify:icd11`, `:orpha`, and `:mondo`
  natively as regression checks on the twice-more-refactored
  `verify-live-release.js` — all three still `"verified"`.
- No changes needed to the arch tests or the CI workflow — same as
  MONDO/ORPHA/ICD-11's precedent, #555's directory-wide arch-test design
  and the generic `workflow_dispatch` input already cover any new
  registry entry automatically.
- Did **not** touch `src/reference-data/reference-imports/sources/icd10.js`
  (the fixture source config) — confirmed via `icd11.js`'s precedent that
  the fixture-source comment intentionally stays pointed at "#550 the
  live-verify follow-up" without being updated once that follow-up lands
  for a given source; the live-verify registry (`liveVerifySources.js`)
  is the one place this work records itself, per the architectural
  boundary `reference-import-boundary.arch.test.js`/
  `reference-live-verify-boundary.arch.test.js` enforce.

Verified: 60/60 architecture tests (native, `node --test`, unchanged
count), 121/121 unit tests across `tests/unit/reference-imports/`
(vitest, up from 118 — the 3 new ICD10 cases), lint (383 files) clean,
all four live-verify scripts (ICD10, ICD11 regression, ORPHA regression,
MONDO regression) run natively against their real upstreams.

Own branch `test/557-live-verify-icd10` (same `test/<slug>` fallback as
prior #557 slices), committed, merged (no-ff) into
`feature/docker-e2e-backend-integration`, pushed (`607542b0`), local
branch deleted (never pushed to remote, so no remote delete needed).
**#557 left open** with a progress comment (5 of 15 done — HPO, MONDO,
ORPHA, ICD-11, ICD-10 — 10 remain) — not closed, since the issue covers
all 15 sources and only one landed this session.

`wrap-up` filed one issue: **dyeallpies-skills-pack#266** — the
`build-loop` BioAvanceD-v2 overlay's "Not every RF028 Fase 2 source is
GitHub-hosted" bullet had gone stale: it predicted CID-11/CID-10 would
share one new third `kind` or need a "not live-verifiable" carve-out.
Neither happened — ICD-11 used `'redirect-version'` and ICD-10 needed
its *own* fourth `kind`, `'fixed-edition'`, plus the license-surface
lesson above. Filed against the skills-pack tracker with the exact
replacement paragraph, rather than edited directly, because the overlay
file at `.claude/skills/build-loop/local-env/bioavanced-v2.md` is a
junction into the skills-pack clone (Rule 0) — confirmed the hard way
this session when a first attempt to edit it in place was blocked by the
pack's own guard hook.

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `607542b0`, clean,
  pushed, up to date with origin. Carries #555/#556's live-verify
  infrastructure + HPO pilot + MONDO + ORPHA + ICD-11 (prior sessions) +
  this session's ICD-10 entry and the fourth-`kind`-generalized
  `verify-live-release.js`, on top of #549's full 16-source Fase 2
  fixture-import group.
- Issues this session: **none closed**. **#557 open**, progress comment
  added (HPO/MONDO/ORPHA/ICD-11/ICD-10 done, 10 sources remain: OMIM,
  HGNC, LOINC, UCUM, DCB, ATC, DUO, Uberon, NCBI Taxonomy, Cell Ontology,
  EDAM). **#550 open** (tracking issue for the original 3-way split,
  unchanged). **dyeallpies-skills-pack#266 opened** (pack-repo tracker,
  stale-overlay fix for the ICD-11/ICD-10 prediction — see above).
- Docker: not used this session — live-verify is a network-only script,
  no Mongo/Docker involved, same as HPO/MONDO/ORPHA/ICD-11 precedent.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from before — see earlier handoffs for the full list;
  not re-enumerated here to avoid drift from a list nobody re-verified
  this session either).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
`handoff`'s own rule, nothing is queued.

Candidates carried forward:

- **#557** — continue the live-verify pattern for the next source in
  recommended order: **OMIM** (§7.4 step 4, last member of the
  "ORPHA, CID-11, CID-10, OMIM" group). Per `dict-01_FONTES.md`'s
  SRC_OMIM row, OMIM is a licensed/keyed API (`https://omim.org/api/`,
  "Chave/API/licença") with the general `omim.org` landing page as the
  only unauthenticated surface known so far — **check whether that
  landing page (or any OMIM docs/about page) exposes a release/version
  signal and license terms unauthenticated before assuming this needs a
  "not live-verifiable without credentials" carve-out** (the same check
  that resolved ICD-11's and ICD-10's nominally-gated sources into real
  `kind`s rather than carve-outs, both times — see
  dyeallpies-skills-pack#266 for the fuller ICD-10 context). If OMIM
  really has no public unauthenticated surface, this would be the first
  Fase 2 source needing the documented carve-out itself, which is its
  own kind of "shape to confirm and record."
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
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263/#265/#266**
  — pack-repo only, low priority except #266 (the stale ICD-11/ICD-10
  prediction fix for the very next #557 slice's own overlay text),
  unchanged otherwise this session.

## Dev stack state

Not brought up this session — no Docker/database-dependent code touched.
Same state as the prior handoff left it: torn down, named volumes
(mongodb/neo4j data) untouched, images cached.

## Which skills to use

- `build-loop`'s "check spec docs for recommended order before asking the
  user which sub-item to start with" guidance paid off again — §7.4 gave
  ICD-10 as the unambiguous next pick after ICD-11 with no need to ask
  Dennis.
- Confirmed pattern for future #557 sources, unchanged from the prior
  handoff: (1) read the existing fixture source file in
  `src/reference-data/reference-imports/sources/<code>.js` for
  `systemUri`/`license`/`licenseUri`, (2) check `dict-01_FONTES.md`'s row
  for the source's stated distribution channel first — GitHub repo,
  direct-download URL, or an authenticated API — rather than assuming the
  GitHub shape, (3) for a nominally API-key-gated source, also check
  whether the authority's public website exposes the release/license
  signal unauthenticated before assuming no live-check is possible (#265,
  reconfirmed by ICD-10's license surface this session — see #266), (4)
  for a GitHub-hosted source: `gh api repos/<org>/<repo>` for license
  auto-detection + `.../releases/latest` for the asset list; for a
  direct-download source: `curl -I` the stable asset URL and
  `curl`/WebFetch the license-bearing page for the pointer phrase; for a
  redirect-based source (ICD-11's shape): GET the stable "latest" URL and
  read the redirect target (`response.url`) rather than HEAD (may 405);
  for a fixed-edition source (ICD-10's shape, new this session): GET the
  stable page URL directly (HEAD also works here, unlike the redirect
  shape) and extract the edition from the page body via regex, (5) add
  the registry entry (with the right `kind`) + npm script + mocked unit
  tests + run the live script natively, re-running the already-landed
  sources too as a regression check whenever `verify-live-release.js`
  itself changed.
- **New lesson this session**: `.claude/skills/build-loop/local-env/`
  overlay files are junctions into the skills-pack clone, not
  project-local editable files, even though they're gitignored in this
  repo (gitignored ≠ project-local-and-freely-editable — those are
  independent facts, and this session initially conflated them). Editing
  one directly from a BioAvanceD-v2 session is blocked by the pack's own
  guard hook (Rule 0) the same as any other pack skill file; file an
  issue against the skills-pack repo with the exact replacement text
  instead (see dyeallpies-skills-pack#266 for the pattern used this
  session).
