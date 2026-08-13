# HANDOFF

**Written:** 2026-08-13, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Pick #557" (following the prior handoff's top candidate).

## What happened this session

Read the prior HANDOFF, then routed #557 ("apply #556's live-download +
license-verification pattern to the remaining 15 Fase 2 sources") via
`work-issue` → `build-loop` (route 4: capability spec'd/pattern-established
but not yet built for these sources, proven with a real-backend/real-upstream
test — not a bug, not existing-code coverage).

- Read #557's body and #555/#556's existing `live-verify/` infrastructure
  (`fetchLiveRelease.js`, `liveVerifySources.js`, `verify-live-release.js`)
  before picking a slice. 15 sources in one issue is too big for one
  iteration — #557's own body anticipated this ("can still be split further
  per-source at pickup time"), so no separate `divide-and-conquer` call was
  needed; just sliced to one source per build-loop's normal sizing.
- Checked `docs/docs-7-31-2026/3-Plano_Integrado_Foundation_Data_Pipeline.md`
  §7.4 "Ordem recomendada da Fase 2" for sequencing before picking which
  source: HPO (done, #556) then **MONDO** is next in the recommended order
  (step 3), ahead of ORPHA/CID-11/CID-10/OMIM (step 4).
- **MONDO confirmed live against the real upstream, not assumed**:
  `gh api repos/monarch-initiative/mondo` — license auto-detected as
  `CC-BY-4.0` (unlike HPO's `NOASSERTION`; matches `sources/mondo.js`'s
  `'CC BY 4.0'` fixture license exactly). `gh api
  repos/monarch-initiative/mondo/releases/latest` — latest release
  `v2026-08-04` includes `mondo.owl`, matching `sources/mondo.js`'s
  `systemUri` basename. `curl` on the repo's `LICENSE` file confirmed
  `"Attribution 4.0 International"` full-legal-text pointer (MONDO's
  license page isn't a redirect like HPO's, so the pointer target is the
  license text itself, not an external URL string).
- Added `MONDO` entry to `liveVerifySources.js`, `reference:live-verify:mondo`
  npm script, 2 new mocked-fetch unit tests (+ generalized the existing HPO
  mock helper from matching `LICENSE.md` literally to matching any
  `LICENSE*` filename, since MONDO's file is bare `LICENSE`).
- **`npm run reference:live-verify:mondo` run natively end-to-end against
  the real GitHub API/LICENSE file** — reports `status: "verified"`.
- No changes needed to the arch tests, the CI workflow, or
  `fetchLiveRelease.js`/`verify-live-release.js` — #555's directory-wide
  arch-test design and generic CLI (`dataset_code` as a workflow input)
  already cover any new registry entry automatically, confirming that
  infrastructure is source-agnostic as intended.

Verified: 60/60 architecture tests (native, `node --test`, unchanged count —
directory-wide checks, no new per-source line needed), 6/6 unit tests
(vitest, up from 4 — the 2 new MONDO cases), lint (383 files) and typecheck
clean, the live-verify script run natively against the real MONDO upstream.

Own branch `test/557-live-verify-mondo` (no dedicated `build-loop` prefix
exists yet; used the `test/<slug>` fallback per the build-loop overlay),
committed, merged (no-ff) into `feature/docker-e2e-backend-integration`,
pushed (`51129cb7`), branch deleted (local + remote). **#557 left open**
with a progress comment (1 of 15 done, 14 remain) — not closed, since the
issue covers all 15 sources and only one landed this session.

`wrap-up` ran clean — no friction, scope stayed to the 3 files the slice
implied (`package.json`, `liveVerifySources.js`, the unit test file), no
lazy fixes, no new issues needed (the 14 remaining sources are already
covered by #557 itself, explicitly left open for them).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `51129cb7`, clean,
  pushed, up to date with origin. Carries #555/#556's live-verify
  infrastructure + HPO pilot + this session's MONDO entry on top of #549's
  full 16-source Fase 2 fixture-import group.
- Issues this session: **none closed**. **#557 open**, progress comment
  added (MONDO done, 14 sources remain: ORPHA, CID-11, CID-10, OMIM, HGNC,
  LOINC, UCUM, DCB, ATC, DUO, Uberon, NCBI Taxonomy, Cell Ontology, EDAM).
  **#550 open** (tracking issue for the original 3-way split, unchanged).
- Docker: not used this session — live-verify is a network-only script, no
  Mongo/Docker involved, same as #556's HPO pilot precedent.
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from before — see earlier handoffs for the full list;
  not re-enumerated here to avoid drift from a list nobody re-verified
  this session either).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
`handoff`'s own rule, nothing is queued.

Candidates carried forward:

- **#557** — continue the live-verify pattern for the next source in
  recommended order: **ORPHA** (§7.4 step 4, same group as CID-11/CID-10/
  OMIM — translate "CID" → "ICD" before grepping `dict-01_FONTES.md`, per
  the build-loop overlay's confirmed trap). Each source needs its own
  live-API confirmation (`gh api`/`curl`/WebFetch) before writing a
  `liveVerifySources.js` entry — same discipline HPO/MONDO both used.
  14 sources remain; can keep splitting one-per-iteration or bundle a
  few per iteration once the per-source effort is well understood (this
  session's MONDO slice took no infrastructure changes at all, just a
  registry entry + tests + live confirmation — future sources may go
  faster once that's confirmed as the steady-state shape).
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
- **skills-pack#233/#234/#235/#236/#237/#238/#239/#240/#241/#243/#244/#246/#247/#250/#251/#254/#259/#260/#262/#263**
  — pack-repo only, low priority, unchanged this session.

## Dev stack state

Not brought up this session — no Docker/database-dependent code touched.
Same state as the prior handoff left it: torn down, named volumes
(mongodb/neo4j data) untouched, images cached.

## Which skills to use

- `work-issue` → `build-loop` routing worked cleanly for #557: the issue
  itself already named the "capability pattern established, apply to N
  more instances" shape and even pre-anticipated the per-source split, so
  no back-and-forth was needed to classify it correctly.
- `build-loop`'s "check spec docs for recommended order before asking the
  user which sub-item to start with" guidance paid off again — §7.4 gave
  MONDO as the unambiguous next pick after HPO with no need to ask Dennis.
- Confirmed pattern for future #557 sources: (1) read the existing fixture
  source file in `src/reference-data/reference-imports/sources/<code>.js`
  for `systemUri`/`license`/`licenseUri`, (2) `gh api repos/<org>/<repo>`
  for license auto-detection (compare `spdx_id` against the fixture's
  license — matches mean a straightforward `LICENSE` file check; a
  `NOASSERTION` case like HPO needs the actual license file read for a
  pointer phrase instead), (3) `gh api repos/<org>/<repo>/releases/latest`
  for the asset list, confirm the fixture's `systemUri` basename appears,
  (4) add the registry entry + npm script + 2 mocked unit tests + run the
  live script natively. No infrastructure changes needed per-source —
  `liveVerifySources.js` is the only file that grows.
