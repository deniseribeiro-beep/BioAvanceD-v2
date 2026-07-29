# HANDOFF

**Written:** 2026-07-29, end of a `work-issue` → `fix-bugs` session —
closed #316 (Playwright/Docker image version drift blocking all
real-backend e2e Docker verification).

**Branch:** `test/e2e-real-backend-foundation`, pushed to
`origin/test/e2e-real-backend-foundation` this session (65338251, merge
of 95a37800).

## What happened this session

1. Read the prior handoff, routed via `work-issue` to #316 — the
   clear unblocked pick per last session's own recommendation (no
   owner design call needed on *whether* to fix it, only on *which
   side* — image vs. npm package — chases the other).
2. Asked Dennis via `AskUserQuestion` which side is source of truth
   (genuine design fork, not dissolvable by tracing). Answer: bump the
   Docker image, don't pin `@playwright/test`.
3. `fix-bugs` for #316: bumped `Dockerfile.playwright`'s base image
   from `mcr.microsoft.com/playwright:v1.58.2-noble` to
   `v1.61.1-noble` to match what `package-lock.json` actually resolves
   `@playwright/test` (`^1.58.2`) to.
4. Docker was on this session (Dennis's go-ahead at session start).
   Rebuilt `playwright-runner`, brought up the full `compose.test.yml`
   stack (came up healthy), and ran
   `tests/e2e/sensor-registration.spec.ts` for real — the browser
   launch error from #316 is gone entirely (grepped the full output
   for "Executable doesn't exist" / "browserType.launch" — no hits).
5. Both tests in that spec still failed, but on a *different*, unrelated
   cause: `playwright-runner` has no `E2E_MONGO_URI` env var in
   `compose.test.yml`, so `tests/e2e/helpers/seedSensor.ts` falls back
   to `localhost:27017`, unreachable inside the container network
   (Mongo is the separate `mongodb-test` service). **Filed as new issue
   #317** rather than expanding scope — #316 was specifically about the
   image/browser-binary mismatch, and that part is confirmed fixed.
6. Committed on `fix/playwright-docker-image-bump` (95a37800),
   commented the hash + verification detail on #316, merged into
   `test/e2e-real-backend-foundation` (65338251, `--no-ff`), deleted the
   local and remote fix branch, pushed the integration branch, closed
   #316 referencing the merge commit and #317.
7. Docker stack torn down clean (`down --volumes --remove-orphans`)
   after verification, before continuing.

## Repo state

- Working tree clean, `test/e2e-real-backend-foundation` is pushed and
  up to date with `origin/test/e2e-real-backend-foundation` at
  65338251.
- `test/migrate-rcs-governance-indexes-coverage` still carries the
  unmerged coverage work from issue #285 (untouched, not in scope).
- The remote branch `origin/fix/mongo-audit-repo-generate-movement-id`
  (from the #296 session) may still be undeleted — not touched this
  session, carried forward from prior handoffs.
- **#316 is closed.** Docker-based real-backend e2e verification is
  now unblocked at the browser-launch level.
- **#317 is open and new this session** — `playwright-runner` in
  `compose.test.yml` needs an `E2E_MONGO_URI` (and possibly
  `E2E_MONGO_DB`) env var pointing at `mongodb-test:27017`; without it,
  any spec using `tests/e2e/helpers/seedSensor.ts` (or similar
  Mongo-seeding helpers) fails on `ECONNREFUSED 127.0.0.1:27017`
  even though the browser now launches fine. This is the next thing
  blocking a *fully green* Docker run of `sensor-registration.spec.ts`
  (and likely other specs).
- **#313, #314 are still open**, unpicked, both need Dennis's design
  call (silent metadata-link failure signal; maintenanceStatus enum
  mismatch). `dyeallpies-skills-pack#140` (branch-naming conflict — not
  hit this session, `fix/playwright-docker-image-bump` is a clean
  `fix/<slug>` name), `#139`, `#138` all still open in the pack repo,
  not touched this session.

## Recommended next steps

None queued explicitly by Dennis this session. Given this session's own
finding, **#317 (playwright-runner missing E2E_MONGO_URI) is a small,
unambiguous next pick** — it's the last thing standing between
`sensor-registration.spec.ts` and a fully green Docker run, and likely
blocks other Mongo-seeding specs too. Also still open and unpicked:
**#313** (needs Dennis's call on the right signal), **#314** (needs
Dennis's call on which side changes), `#301`, `#302` (both #298-era),
`#295` (RF004 AC#3 — needs Dennis), `#297` (RF006 AC#6 — needs Dennis),
`#307` (run-cycle route auth — needs Dennis's call), `#115` (Orphadata
partial-coverage design call — needs Denise), `#293` (TOTP helper —
needs Dennis), and `#304` (real Neo4j `propagateCompromise` + full AC#6
e2e). All Wave 1 RFs are done per `E2E_TRACEABILITY_PLAN.md` — the next
`test-loop` pickup should be whichever Wave 2 RF the traceability doc
lists next (not checked this session — read `E2E_TRACEABILITY_PLAN.md`
fresh).

## Which skills to use

`work-issue` to route the next issue. `fix-bugs` applies directly to
#317 (compose.test.yml env var addition, reproduction via the same
sensor-registration.spec.ts run). `test-loop` applies to whichever
Wave 2 RF gets picked next (check `E2E_TRACEABILITY_PLAN.md`);
`resolve-issue` applies to #313/#314 (both need an owner decision
first) and #304; `bioavanced-v2-conventions`,
`bioavanced-v2-testing-conventions`, and `docker-workflow` all apply to
this family of work.
