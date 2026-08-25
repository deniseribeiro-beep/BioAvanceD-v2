# HANDOFF

**Written:** 2026-08-25. **Still inside a rabbit hole** (tracker **#725**)
-- mid-sitting rotation after closing **#742** (split off #723 by its
RF013 spec). #723's two specs are merged; its own Definition-of-Done
gate (the full real-backend e2e run) is executing right now, and #723
closes once it's green. This sitting's ~10-point budget is spent
(#737 3 + #723 specs 5 + #742 2).

## Rabbit-hole state

Tracker: **#725**, open. Members: `#723`/`#724` and direct splits --
`#724`/`#726`/`#727`/`#728`/`#730` closed in prior sittings; **`#737`
and `#742` closed this sitting**. Queue: **#723 only**, and only its
gate + close remain.

## What landed this sitting

- **#737 -- CLOSED** (`fad97da3`): `seedReportTemplates` wired into
  `server.js` boot (+ `npm run seed:report-templates`); RF008 had been
  functionally dead on every live stack post-#726.
- **#723 -- specs merged** (`d0e6d1ec`): RF008 block in
  `tests/e2e/scientific-data-access.spec.ts` (7 tests, every AC + a
  `/reports` → query page → CSV download UI leg); RF013 block in
  `tests/e2e/pipeline-continuity.spec.ts` (5 tests, every AC + a
  `/backup` UI leg). `E2E_TRACEABILITY_PLAN.md` RF008/RF013 rows
  MISSING → DONE. Both blocks green on the live stack (RF008 7/7 twice,
  RF013 5/5 three times).
- **#742 -- CLOSED** (`7e97cbe0`): `computeDirChecksum` excludes
  `manifest.json`, so restore-test's `checksumVerified` is finally
  `true` (was structurally always false; red-first from the RF013 spec,
  unit test + un-pinned e2e assertion).
- **Findings filed, not queue members:** #738 (no mongodump in the Docker
  image → lossy JSON fallback always), #739 (RF008 AC#1: only `status`
  of six filter dimensions wired), #740 (BackupPage doesn't render
  status/checksum), #741 (patient-list narrowing only when the sample
  filter matched something). Skills-pack: #398 (Rule-0 hook false
  positives on reads / issue bodies), #399 (where a new seed belongs),
  #400 (playwright-specs overlay gotchas: `app_language` pin, handler
  caps, zero-testid pages), #401 (long heredocs fail in the Bash tool).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed, up to date with
  origin as of `7e97cbe0` plus this rotation. No fix/test branches left
  (all merged and deleted locally; none were pushed as remotes).
- **Docker is UP** (`compose.test.yml` core services, admin bootstrapped,
  `playwright-runner` stopped). `backend-app-test` rebuilt twice this
  sitting (#737, #742) -- current image carries both fixes. Host-side
  run recipe that works is in the scratchpad `run-e2e.sh` pattern:
  `PLAYWRIGHT_BASE_URL=http://localhost:5173
  PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1
  TEST_USER=admin TEST_PASS=Admin@123
  E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true"
  E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j
  TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test ...`.
- **Full e2e gate in flight** for #723 (200 tests / 16 files, log in
  the session scratchpad). If this file is what you're reading after a
  cut-off: re-run that full suite, then close #723 if green (its DoD),
  decide the Wave 4 showcase reel (`e2e-showcase-video`; RF008's
  `/reports` → export and RF013's `/backup` flows are both demo-able --
  split as its own issue under #725 if not done this sitting), then run
  #725's upward-cascade check and close the tracker.
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward again.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

Finish #723's gate/close as above (this sitting if the run comes back
green; otherwise triage `test-results/` first -- fixture accumulation
in `mongodb-test-data` is the usual false alarm per `docker-workflow`'s
overlay). Then exit the rabbit hole: close #725 naming every member
resolved across its sittings (#723, #724, #726, #727, #728, #730, #737,
#742). Nothing else queued.
