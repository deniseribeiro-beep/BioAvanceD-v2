# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Continue 557" (following the prior handoff's top candidate).

## What happened this session

Continued #557 ("apply #556's live-download + license-verification pattern
to the remaining Fase 2 sources") via `build-loop`, picking up right after
the prior session's ORPHA slice.

- Per `docs/docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md`
  §7.4 "Ordem recomendada da Fase 2" step 4's "ORPHA, CID-11, CID-10 e
  OMIM" group, the next source after ORPHA is **ICD-11** (dict-01's
  `SRC_ICD11` — remember to translate CID→ICD before grepping the dict,
  per the build-loop overlay's confirmed trap).
- `dict-01_FONTES.md`'s `SRC_ICD11` row correctly flags the WHO ICD API
  itself (`https://icd.who.int/icdapi`) as OAuth/API-key gated — but that
  turned out not to be the whole story. **Discovered `icd.who.int`'s
  public browser (a separate surface from the API) is unauthenticated**:
  `GET https://icd.who.int/browse/latest-release/mms/en` 302-redirects to
  the current release's own path (confirmed live 2026-08-13:
  `Location: /browse/2026-01/mms/en`; HEAD isn't usable there — 405).
  License is a WHO-hosted PDF linked from `icd.who.int/en` as "ICD-11
  License" (`ICD11-license.pdf`); confirmed its raw bytes still surface a
  plain-ASCII pointer phrase ("World Health Organization") through a
  normal UTF-8 `.text()` decode, so the existing `fetchText()` helper
  works on it unmodified.
- **Generalized `verify-live-release.js` with a third `kind`**:
  `'redirect-version'` (ICD-11's shape — GET a stable "latest" URL,
  extract the release version from the redirect target via
  `response.url`, no releases API or asset check involved), alongside
  the existing `'github-release'` (HPO/MONDO) and `'direct-download'`
  (ORPHA). Added `fetchRedirectTarget()` to `fetchLiveRelease.js`.
- Added the `ICD11` entry to `liveVerifySources.js`, `reference:live-verify:icd11`
  npm script, 3 new mocked-fetch unit tests (verified/mismatch-redirect/
  mismatch-license, mirroring the HPO/MONDO/ORPHA cases but exercising
  the new redirect-version mock shape).
- **`npm run reference:live-verify:icd11` run natively end-to-end against
  the real icd.who.int upstream** — reports `status: "verified"`.
  Also re-ran `reference:live-verify:orpha` and `reference:live-verify:mondo`
  natively as regression checks on the twice-refactored
  `verify-live-release.js` — both still `"verified"`.
- No changes needed to the arch tests or the CI workflow — same as
  MONDO/ORPHA's precedent, #555's directory-wide arch-test design and the
  generic `workflow_dispatch` input already cover any new registry entry
  automatically.

Verified: 60/60 architecture tests (native, `node --test`, unchanged
count), 118/118 unit tests across `tests/unit/reference-imports/`
(vitest, up from 115 — the 3 new ICD11 cases), lint (383 files) clean,
all three live-verify scripts (ICD11, ORPHA regression, MONDO
regression) run natively against their real upstreams.

Own branch `test/557-live-verify-icd11` (same `test/<slug>` fallback as
prior #557 slices — no dedicated `build-loop` prefix exists yet),
committed, merged (no-ff) into `feature/docker-e2e-backend-integration`,
pushed (`a07a3d4e`), local branch deleted (never pushed to remote, so no
remote delete needed).
**#557 left open** with a progress comment (4 of 15 done — HPO, MONDO,
ORPHA, ICD-11 — 12 remain) — not closed, since the issue covers all 15
sources and only one landed this session.

`wrap-up` filed one issue: **dyeallpies-skills-pack#265** — a follow-up
to the now-closed `#264`, since ICD-11's slice resolved #264's "part 2"
question (whether CID-11/CID-10/OMIM would need a third `kind` or a
"not live-verifiable without credentials" carve-out) with an answer
neither option anticipated: the API being auth-gated doesn't mean the
*authority's public website* is too — check for an unauthenticated
browse/docs/landing surface exposing the same release signal before
assuming the carve-out applies. Flags that CID-10 (fixed-edition browse
page per the dict, not a "latest" redirect — may not reuse ICD-11's
shape verbatim) and OMIM (licensed/keyed API, no public surface found
yet) are still genuinely open. Filed against the skills-pack tracker
rather than edited directly (Rule 0 — this session isn't a pack-repo
session).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `a07a3d4e`, clean,
  pushed, up to date with origin. Carries #555/#556's live-verify
  infrastructure + HPO pilot + MONDO + ORPHA (prior sessions) + this
  session's ICD-11 entry and the third-`kind`-generalized
  `verify-live-release.js`, on top of #549's full 16-source Fase 2
  fixture-import group.
- Issues this session: **none closed**. **#557 open**, progress comment
  added (HPO/MONDO/ORPHA/ICD-11 done, 12 sources remain: CID-10, OMIM,
  HGNC, LOINC, UCUM, DCB, ATC, DUO, Uberon, NCBI Taxonomy, Cell Ontology,
  EDAM). **#550 open** (tracking issue for the original 3-way split,
  unchanged). **dyeallpies-skills-pack#265 opened** (pack-repo tracker,
  follow-up to the now-closed #264 — see above).
- Docker: not used this session — live-verify is a network-only script,
  no Mongo/Docker involved, same as HPO/MONDO/ORPHA precedent.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from before — see earlier handoffs for the full list;
  not re-enumerated here to avoid drift from a list nobody re-verified
  this session either).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
`handoff`'s own rule, nothing is queued.

Candidates carried forward:

- **#557** — continue the live-verify pattern for the next source in
  recommended order: **CID-10 (ICD-10)** (§7.4 step 4, same group as
  ORPHA/ICD-11/OMIM — translate "CID" → "ICD" before grepping
  `dict-01_FONTES.md`). **Known trap before assuming ICD-11's shape
  applies:** per `dict-01_FONTES.md`'s SRC_ICD10 row, the "URL oficial"
  is a fixed-edition browse page (`https://icd.who.int/browse10/2019/en`),
  not a "latest release" redirect like ICD-11's — confirm the actual live
  shape (curl/WebFetch) rather than assuming `'redirect-version'` reuses
  verbatim; it may need its own `kind` or turn out to fit one of the
  three already implemented. See dyeallpies-skills-pack#265 for the fuller
  context. OMIM (same step-4 group) is a licensed/keyed API with no known
  public unauthenticated surface yet — may be the first source that
  genuinely needs a "not live-verifiable without credentials" carve-out.
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
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263/#265**
  — pack-repo only, low priority except #265 (adds the live-vs-API-surface
  precedent for the very next #557 slice), unchanged otherwise this
  session.

## Dev stack state

Not brought up this session — no Docker/database-dependent code touched.
Same state as the prior handoff left it: torn down, named volumes
(mongodb/neo4j data) untouched, images cached.

## Which skills to use

- `build-loop`'s "check spec docs for recommended order before asking the
  user which sub-item to start with" guidance paid off again — §7.4 gave
  ICD-11 as the unambiguous next pick after ORPHA with no need to ask
  Dennis.
- **New lesson this session, not yet in the build-loop overlay** (filed as
  dyeallpies-skills-pack#265 rather than edited directly, per Rule 0):
  an API-key-gated dict-01 row doesn't automatically mean "not
  live-verifiable without credentials" — the same authority often runs a
  separate, unauthenticated public website (browse UI, docs page, landing
  page) exposing the same release/version signal the gated API would.
  Check for that surface before reaching for the "can't verify" carve-out.
- Confirmed pattern for future #557 sources, updated: (1) read the
  existing fixture source file in
  `src/reference-data/reference-imports/sources/<code>.js` for
  `systemUri`/`license`/`licenseUri`, (2) check `dict-01_FONTES.md`'s row
  for the source's stated distribution channel first — GitHub repo,
  direct-download URL, or an authenticated API — rather than assuming the
  GitHub shape, (3) **for a nominally API-key-gated source, also check
  whether the authority's public website exposes the release/license
  signal unauthenticated before assuming no live-check is possible** (new
  this session, see #265), (4) for a GitHub-hosted source: `gh api
  repos/<org>/<repo>` for license auto-detection + `.../releases/latest`
  for the asset list; for a direct-download source: `curl -I` the stable
  asset URL and `curl`/WebFetch the license-bearing page for the pointer
  phrase; for a redirect-based source (ICD-11's shape): GET the stable
  "latest" URL and read the redirect target (`response.url`) rather than
  HEAD (may 405), (5) add the registry entry (with the right `kind`) + npm
  script + mocked unit tests + run the live script natively, re-running
  the already-landed sources too as a regression check whenever
  `verify-live-release.js` itself changed.
