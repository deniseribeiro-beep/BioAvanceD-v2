# HANDOFF

**Written:** 2026-08-17, continuation session (twelfth update). User said
"pick the next group of issues to resolve (try doing 5)," AFK but
responded live mid-session for a few judgment calls. Divide-and-conquer
authorized in advance; not needed — worked solo through the batch.

## Issues closed this session

- **#570 + #336** (bundled): `import.controller.js#importFhirBundle`
  (`POST /api/import/fhir`) removed entirely — a dead synchronous FHIR
  write path with no live caller, and a direct violation of RF011
  AC#6/AC#7 (`docs/docs-7-27-2026/extracted/requisitos-index.md`) which
  requires FHIR imports to go through staging/quarantine and forbids
  direct MongoDB/Neo4j writes from the FHIR conversion boundary. Removed
  the route, controller function, its SPREC/quality helpers, and 10
  unit tests; the staging pipeline (`/import/fhir/stage`→`/commit`) is
  now the sole FHIR import path. Updated two stale doc references
  (`canonical-data-contract-v1.md`, `E2E_TRACEABILITY_PLAN.md`).
  Verified: import.controller suite 22/22, architecture suite 60/60,
  backend lint clean. This was a genuine product-scope call (delete vs.
  fix-in-place) — confirmed with the user live before proceeding; he
  pointed at checking the newest-dated docs, which settled it via RF011.
- **#554**: retitled #550 (already closed) from "...14 Fase 2 sources"
  to "...16" — tracker-metadata-only fix, no repo change.
- **#559**: rewrote `docs/architecture/reference-data-seeding.md`'s
  stale "Large imports" section — it still described HPO as the only
  operational Fase 2 importer and live-verify as pure follow-up scope;
  both are done (#549's 16-source sweep, #557's live-verify build-out).
  Verified every claim against current code
  (`scripts/reference-imports/`, `liveVerifySources.js`'s own header)
  before writing it.
- **#489**: re-ran the exact reproduction shape (plain `vitest run`, no
  `--coverage`, full repo) that reported 183 failed tests/89 failed
  files on 2026-08-07. 2026-08-17 re-run: 365/365 files, 6847/6847
  tests, zero failures. Recorded in `api/backend/COVERAGE_NOTES.md` as
  a second non-reproducing instance of the #423 flake class, this time
  confirmed independent of `--coverage`. Closed as confirmed
  non-reproducing, same resolution pattern as #423.

## #599 — fixed, merged, but deliberately UNPUSHED

`ci-pipeline.yml`'s trigger widened to also fire on
`feature/docker-e2e-backend-integration` (mirroring `main`), fixing "no
CI signal on the integration branch" (#599's own suggested next step).
**Committed and merged locally, but the user explicitly said "hold,
don't push yet"** when reminded that milestone #3 ("CI Integration for
E2E Tests") is sequenced after milestone #2 (Playwright e2e, still 2
open issues) per his own 2026-07-27 note: "do not start wiring CI until
#2 closes." Issue #599 itself is still **open** — do not close it until
the push is cleared and it actually lands.

**This blocks pushing the whole branch right now**: #599's two commits
are the earliest of six local commits ahead of `origin` on
`feature/docker-e2e-backend-integration` (linear history — everything
else, including the now-closed #570/#559/#489 work, is stacked on top).
Don't push until Dennis explicitly clears #599, or the widened trigger
ships along with it. If he asks to ship the other four fixes sooner
without #599, that needs a rebase/cherry-pick onto a fresh point off
`origin/feature/docker-e2e-backend-integration` — ask him first, don't
assume that's wanted.

## CI backlog organization (ad hoc mid-session ask)

Created a new `ci` label. Tagged the three open issues that literally
mention "CI" (#599, #284, #286) with it and linked all three to the
"CI Integration for E2E Tests" milestone. No implementation — organization
only, per explicit instruction not to let CI be implemented yet.

## Repo state

- On `feature/docker-e2e-backend-integration`, 6 commits ahead of
  `origin` (all local, **not pushed** — see #599 above). Working tree
  clean except the gitignored/junctioned `.claude/skills/`.
- Docker: not used this session (all checks were native vitest/lint/
  architecture-test runs).
- Local branches for this session's work already deleted (merged +
  issue closed): `fix/570-remove-dead-fhir-sync-import`,
  `test/559-reference-data-seeding-docs`,
  `test/489-vitest-jwt-regression-recheck`. `fix/599-ci-trigger-integration-branch`
  intentionally kept (merged, but #599 still open).

## Flagged, not acted on

- **Dangling local branch `test/377-docs-on-main`**: not an ancestor of
  either `feature/docker-e2e-backend-integration` or `main`. Carries
  Denise's 2026-07-31 docs-batch material (manuscript/supplementary PDF
  revisions, `docs/Modelagem/*`). Its originating issue #377 is closed,
  but the still-open #379 ("decide whether the 7-31 revisions should
  supersede the CMPB submission copies") is exactly the judgment call
  that gates touching this — per `bioavanced-v2-conventions`' doc-drop
  triage rules, don't merge or discard without Dennis/Denise's explicit
  call first.

## Recommended next steps

None queued by the user. When milestone #2 (Playwright e2e) closes and
#599's push is cleared, that's the natural point to also look at
starting milestone #3 (#284, wiring Playwright into CI) — not before.
