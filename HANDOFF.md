# HANDOFF

**Written:** 2026-07-29, end of a `work-issue` → `fix-bugs` session —
closed #315 (sensors table shows Mongo `_id` instead of `sensorId` after
creation).

**Branch:** `test/e2e-real-backend-foundation`, pushed to
`origin/test/e2e-real-backend-foundation` this session (94ae61ba, merge
of f63c352f).

## What happened this session

1. Read the prior handoff, routed via `work-issue` to #315 — the
   clearest unambiguous pick among the open follow-ons from last
   session (#313/#314 both need an owner design call; #315 was a plain
   field-name bug already fully diagnosed).
2. `fix-bugs` for #315: `FacilityManagementPage.tsx`'s sensors table row
   key read `sensor.sensorID` (capital ID) then fell back straight to
   `sensor._id`, skipping the actual field name the backend returns —
   `sensorId` (lowercase d), confirmed against `Sensor.js` and
   `sensor.service.js`. Fixed the fallback chain to check `sensorId`
   too. Un-weakened the `#315`-pinned assertion in
   `tests/e2e/sensor-registration.spec.ts` (previously just waited for
   the modal to close) to assert the table actually shows the real
   sensorId.
3. Brought up `compose.test.yml` (with Dennis's go-ahead — Docker use is
   a per-session opt-in decision) to run the updated e2e spec for real.
   The stack came up healthy, but the Playwright run failed immediately
   on browser launch for **both** tests in the file — unrelated to this
   fix. Root cause: `Dockerfile.playwright` pins
   `mcr.microsoft.com/playwright:v1.58.2-noble`, but
   `package-lock.json` resolves `@playwright/test` (`^1.58.2`) to
   `1.61.1` — a caret-range drift the pinned image doesn't have browser
   binaries for. **Filed as new issue #316** (blocks *any* real-backend
   e2e spec from running in Docker right now, not specific to
   sensor-registration.spec.ts).
4. Given #316 blocks Docker verification entirely, verified the #315
   fix natively instead: frontend `npm run typecheck` clean (both
   pre-merge and on the merged integration-branch tree), and the fix
   traced directly against the backend's actual response shape. Said so
   explicitly in the commit message and the issue-close comment rather
   than silently skipping verification.
5. Committed on `fix/sensor-table-id-display-casing` (f63c352f),
   commented the hash on #315, merged into
   `test/e2e-real-backend-foundation` (94ae61ba, `--no-ff`), deleted the
   local and remote fix branch, pushed the integration branch, closed
   #315 referencing the merge commit and #316.
6. Docker stack torn down clean (`down --volumes --remove-orphans`)
   after the failed verification attempt, before continuing.

## Repo state

- Working tree clean, `test/e2e-real-backend-foundation` is pushed and
  up to date with `origin/test/e2e-real-backend-foundation` at
  94ae61ba.
- `test/migrate-rcs-governance-indexes-coverage` still carries the
  unmerged coverage work from issue #285 (untouched, not in scope).
- The remote branch `origin/fix/mongo-audit-repo-generate-movement-id`
  (from the #296 session) may still be undeleted — not touched this
  session, carried forward from prior handoffs.
- **#315 is closed.** **#316 is open and new this session** — blocks
  all Docker-based real-backend e2e verification (`Dockerfile.playwright`
  pinned to `v1.58.2-noble`, resolved `@playwright/test` is `1.61.1`).
  Any session that needs to actually run a real-backend e2e spec in
  Docker should fix #316 first, or expect every such spec to fail on
  browser launch regardless of the product code under test.
  **#313, #314 are still open**, unpicked, both need Dennis's design
  call (silent metadata-link failure signal; maintenanceStatus enum
  mismatch). `dyeallpies-skills-pack#140` (branch-naming conflict —
  worked around again this session via `fix/sensor-table-id-display-casing`,
  a `fix/<slug>` branch, no new conflict hit), `#139`, `#138` all still
  open in the pack repo, not touched this session.

## Recommended next steps

None queued explicitly by Dennis this session. Given this session's own
finding, **#316 (Playwright/Docker image drift) is worth prioritizing
soon** — it silently blocks Docker verification for every real-backend
e2e session until fixed, and that failure mode (stack comes up healthy,
only the browser launch fails) is easy to misread as a real test
failure if not traced carefully. Also still open and unpicked: **#313**
(needs Dennis's call on the right signal), **#314** (needs Dennis's call
on which side changes), `#301`, `#302` (both #298-era), `#295` (RF004
AC#3 — needs Dennis), `#297` (RF006 AC#6 — needs Dennis), `#307`
(run-cycle route auth — needs Dennis's call), `#115` (Orphadata
partial-coverage design call — needs Denise), `#293` (TOTP helper —
needs Dennis), and `#304` (real Neo4j `propagateCompromise` + full AC#6
e2e). All Wave 1 RFs are done per `E2E_TRACEABILITY_PLAN.md` — the next
`test-loop` pickup should be whichever Wave 2 RF the traceability doc
lists next (not checked this session — read `E2E_TRACEABILITY_PLAN.md`
fresh).

## Which skills to use

`work-issue` to route the next issue. `fix-bugs` applies directly to
#316 (Docker image version bump, or pinning `@playwright/test` exactly
— needs Dennis's call on which side is source of truth). `test-loop`
applies to whichever Wave 2 RF gets picked next (check
`E2E_TRACEABILITY_PLAN.md`); `resolve-issue` applies to #313/#314 (both
need an owner decision first) and #304; `bioavanced-v2-conventions`,
`bioavanced-v2-testing-conventions`, and `docker-workflow` all apply to
this family of work.
