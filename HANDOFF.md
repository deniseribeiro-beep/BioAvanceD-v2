# HANDOFF

**Written:** 2026-08-12, end of session on `feature/docker-e2e-backend-integration`,
after Dennis said "Pick #550" (which the prior handoff had listed as one of
five #549-follow-up candidates, no explicit next-issue queued at the time).

## What happened this session

Picked up #550 ("live download + real license verification for all 16
Fase 2 sources"). #550's own body flagged an unresolved design question —
this repo's `reference-import-boundary.arch.test.js` actively enforces "no
live network calls" across all 16 sources, and #550 needed a decision on
how a live-download exception gets scoped before any implementation.

- Routed #550 → `resolve-issue` (not `build-loop`, since the design
  question was still open) → confirmed via `docs/architecture/
  reference-data-seeding.md` and the arch test itself that the "no live
  network calls" boundary is a real, actively-enforced, 16-times-reasserted
  constraint, not a stale placeholder.
- Asked Dennis directly (`AskUserQuestion`) how to scope the exception:
  chose **"separate CI job"** — live download/license verification runs in
  a dedicated, isolated GitHub Actions workflow, never on push/PR to
  `main`, so the fixture-only boundary stays intact everywhere else.
- Too big for one slice (16 sources' worth) → `divide-and-conquer`'s
  design-split playbook: confirmed a 3-issue breakdown with Dennis, filed
  **#555** (foundational CI-job + fetch/license-check infra), **#556**
  (HPO pilot, depends on #555), **#557** (remaining 15 sources, depends on
  #555+#556), commented the split onto #550 (left open as the tracking
  issue).
- Dennis chose to build #555+#556 this session (not just file and stop):
  - `api/backend/scripts/reference-imports/live-verify/` — `fetchLiveRelease.js`
    (the one module allowed to call `fetch`), `liveVerifySources.js` (registry,
    HPO populated only), `verify-live-release.js` (CLI, `verify()` exported)
    — deliberately **outside** `src/reference-data/reference-imports/` so the
    exception is scoped by directory placement, not just convention.
  - `.github/workflows/reference-data-live-verify.yml`, `workflow_dispatch`-only.
  - `api/backend/tests/architecture/reference-live-verify-boundary.arch.test.js`
    — directory-wide re-check that `reference-imports/` has zero network
    calls (covers all 16 sources + any future one, not per-source lines),
    plus the inverse check that `live-verify/` does, plus a workflow-trigger
    check.
  - `api/backend/tests/unit/reference-imports/live-verify/verifyLiveRelease.test.js`
    — 4 tests, `fetch` mocked, covers verified/mismatch/unknown-source paths.
  - `reference:live-verify` / `reference:live-verify:hpo` npm scripts.
  - **HPO pilot verified against the real live upstream, not assumed**:
    `gh api repos/obophenotype/human-phenotype-ontology` confirmed
    `license.spdx_id: "NOASSERTION"` (no auto-detected SPDX license — the
    repo's own `LICENSE.md` points at https://hpo.jax.org/app/license for
    the real terms, so verification checks that pointer text rather than an
    SPDX id) and the latest release (`v2026-06-23`) includes `hp.owl`,
    matching `sources/hpo.js`'s existing `systemUri`. `npm run
    reference:live-verify:hpo` run natively end-to-end against the real
    GitHub API/LICENSE.md — reports `status: "verified"`.
  - **Verified-license outcome is recorded as the live-verify script's own
    JSON report** (a CI-artifact once run in Actions), not written into
    `ReferenceDatasetRelease`/Mongo — keeps the fixture-based operational
    import pipeline's existing 16-source contract untouched. Noted
    explicitly in #556's close comment as the scoping decision.

Verified: 60/60 architecture tests (native, `node --test`, up from 56 —
4 new: directory-wide network-call re-check, live-verify-does-call-fetch,
CLI-uses-the-module, workflow-trigger-shape), 4/4 new unit tests (vitest,
`fetch` mocked), lint (383 files) and typecheck clean, YAML syntax
validated, the live-verify script run natively against the real HPO
upstream. **The `workflow_dispatch` job itself cannot be triggered on
GitHub Actions until this lands on `main`** (same as every other workflow
in this repo — `ci-pipeline.yml` only fires on push/PR to `main` too) —
expected, not a gap; the native run is this session's equivalent check.

Own branch `fix/550-live-verify-ci-job`, committed, merged (no-ff) into
`feature/docker-e2e-backend-integration`, pushed (`da4d141a`), **#555 and
#556 closed** with summary comments; branch deleted (local + remote).
**#550 and #557 remain open** — #550 as the tracking issue for the split,
#557 (remaining 15 sources) as the follow-up once #556's pattern is
trusted at scale.

**No new issues filed beyond the planned split** (#555/#556/#557
themselves). `wrap-up` ran clean — no friction, no scope creep (`git diff
--stat` for the merge confirmed exactly the 7 intended files), no lazy
fixes.

**Security/safety note:** the new CI job makes unauthenticated, read-only
outbound calls to `api.github.com`/`raw.githubusercontent.com` — this is
the explicit trust-boundary crossing Dennis approved via the "separate CI
job" design-call answer this session, not a silent addition. No secrets,
no write access, no code execution from fetched content (comparison only).

## Repo state

- **`feature/docker-e2e-backend-integration`**: at `da4d141a`, clean,
  pushed, up to date with origin. Carries #555/#556's live-verify
  infrastructure + HPO pilot on top of #549's full 16-source Fase 2 group.
- Issues this session: **#555 closed**, **#556 closed**. **#550 open**
  (tracking issue for the 3-way split, not itself resolved — the other 15
  sources' live-verify work is still ahead). **#557 open** (remaining 15
  sources, depends on #555+#556, both now shipped so #557 is unblocked
  whenever picked up).
- Docker: not used this session (no Docker/CI-gate-relevant native code
  touched — scripts run under plain `node`, no compose service added).
- **Pre-existing dangling branches, not touched this session** (carried
  forward unchanged from before — see earlier handoffs for the full list;
  not re-enumerated here to avoid drift from a list nobody re-verified
  this session either).

## Which issue is next

Dennis has not explicitly said which issue to pick up next session — per
`handoff`'s own rule ("only if the user explicitly said so; otherwise
write 'none queued'"), nothing is queued.

Candidates carried forward:

- **#557** — apply #556's live-download/license-verification pattern to
  the remaining 15 Fase 2 sources (MONDO, ORPHA, ICD-11, ICD-10, OMIM,
  HGNC, LOINC, UCUM, DCB, ATC, DUO, Uberon, NCBI Taxonomy, Cell Ontology,
  EDAM) — each needs its own live-API confirmation (`gh api`/WebFetch)
  before writing a `liveVerifySources.js` entry, same discipline HPO's
  pilot and EDAM's #549 slice both used. Can be split further per-source
  at pickup time if the real per-source effort turns out to warrant it
  (noted as an option in #557's own body).
- **#550** — stays open as the tracking issue until #557 (and any
  further split) lands; not independently actionable beyond that.
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

- `resolve-issue` → `divide-and-conquer`'s "blocker is a real design
  change" playbook worked cleanly end-to-end this session: read the
  issue's own design question, checked docs/arch-test for whether it was
  already answered (it wasn't — genuinely needed Dennis's call), asked via
  `AskUserQuestion`, then designed and confirmed a 3-issue breakdown before
  filing anything. No friction, no rework.
- The placeholder-token trick (file issue 1 with `#<PILOT_ISSUE>`-style
  placeholders since later issue numbers aren't known yet, then
  `gh issue edit` issue 1 once the real numbers exist) worked fine for a
  small 3-issue group with forward references — not worth a skill note at
  this scale, but would be worth documenting if a future split runs to
  many more cross-referencing issues.
- New arch-test technique this session: a **directory-wide** re-scan
  (`listJsFilesRecursive` over the whole `reference-imports/` tree) as a
  companion to the existing **per-source-file** boundary assertions —
  the per-source lines still document each source's own history, but the
  directory-wide check means a 17th/18th source (or any new file added to
  the tree) is covered automatically without a new arch-test line each
  time. Reasonable pattern to reuse if #557 wants to avoid 15 more
  hand-written boundary-test blocks.
