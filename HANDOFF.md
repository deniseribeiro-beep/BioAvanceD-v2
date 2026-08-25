# HANDOFF

**Written:** 2026-08-25. **Still inside a rabbit hole** (tracker **#725**)
-- mid-sitting rotation after closing **#737**, a bug split off #723 the
moment its RF008 real-backend spec work started. #723 itself is in
progress on this same sitting (its first RF008 test landed with the
#737 fix); the remainder of its RF008/RF013 spec work continues next.

## Rabbit-hole state

Tracker: **#725** ("Rabbit-hole tracker: RF008/RF013 backend gaps +
equipment fixture cleanup (seeds #723, #724)"), open. Membership is
strictly `#723`/`#724` and their direct splits -- `#726`/`#727`/`#728`/
`#730`/`#724` all closed in prior sittings; **`#737` closed this
sitting**. Fresh ~10-point pacing budget this sitting; ~3 points spent
so far (#737, medium: fix + live verification + regression test).

Queue: **#723 only** (RF008/RF013 real-backend Playwright specs --
Definition of Done is a real-backend spec per RF + green
`test:e2e:docker`; started this sitting, see below).

## What landed this sitting

**#737 (ReportTemplate seed never ran on any live stack) -- CLOSED.**
Found live: post-#726, `reports.routes.js`'s `buildPreviewData`
dispatches only via a `reportTemplates` lookup, but `seedReportTemplates`
was only reachable through an unwired script -- every report type
returned the no-preview fallback, CSV export was "Sem dados". Fix:
`server.js#startServer` now calls the idempotent seed at boot (non-fatal)
and `npm run seed:report-templates` exists for manual runs. Branch
`fix/737-seed-report-templates-on-boot` @ `68d066cd`, merged into
`feature/docker-e2e-backend-integration` @ `fad97da3`, pushed, local
branch deleted (never pushed as its own remote). Verified live on the
`compose.test.yml` stack after rebuilding `backend-app-test`: boot log
"14 garantidos", preview returns 106 samples, populated CSV.

**#723 (RF008/RF013 specs) -- IN PROGRESS.** The first RF008 test
(`tests/e2e/scientific-data-access.spec.ts`, describe "Reports (RF008)
-- real backend") landed with the #737 fix as its red-first regression
test. The rest of the RF008 block and the whole RF013 block
(`tests/e2e/pipeline-continuity.spec.ts` per the plan's file mapping)
are not written yet; `E2E_TRACEABILITY_PLAN.md` rows for RF008/RF013
still say MISSING.

**Findings filed this sitting (not queue members -- ordinary case-4
adjacent finds):** #738 (Docker images ship no mongodump/mongorestore, so
every containerized backup takes the lossy JSON fallback -- ObjectId/Date
become strings on restore), #739 (RF008 AC#1: sample-rooted report
handlers honor only `status` of the six named filter dimensions), #740
(BackupPage doesn't show the status/checksum `GET /api/backup/list`
already returns). Skills-pack: #398 (Rule-0 Bash hook false-positives on
read-only `ls`/`cat` and on issue bodies quoting the junction path), #399
(conventions overlay should record where a new seed belongs).

## Repo state

- On `feature/docker-e2e-backend-integration`, pushed and up to date
  with origin as of `fad97da3` plus this HANDOFF rotation.
- **Docker is UP** (`compose.test.yml` core services + `admin-bootstrap-test`
  ran; `playwright-runner` stopped so host-side Playwright runs don't
  contend). `backend-app-test` was rebuilt with the #737 fix;
  `frontend-app-test` was built fresh at bring-up. Host-side run recipe
  used (works): `PLAYWRIGHT_BASE_URL=http://localhost:5173
  PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1
  TEST_USER=admin TEST_PASS=Admin@123
  E2E_MONGO_URI="mongodb://localhost:27017?directConnection=true"
  E2E_MONGO_DB=bioavanced_test E2E_NEO4J_DATABASE=neo4j
  TEST_SUPPORT_SECRET=e2e-test-support-secret npx playwright test <spec>
  --grep "<RF>" --reporter=list`.
- Two untracked paths present, not touched: `.claude/skills/` and
  `api/backend/storage/assays/` -- pre-existing, carried forward again.
- No open PR; nothing pushed to `main`; `main` stays frozen.

## Recommended next steps

Continue **#723** on a `test/723-...` branch off the feature branch:
finish the RF008 block (AC#1 status filter + note #739, AC#2 role/org
restriction via a Técnico session with no organization → 403, AC#3
pseudonymization -- `patients` preview carries `participantId` but no
`patientName`/`birthDate`, AC#4 csv+pdf exports and a non-enabled format
refused, AC#5 export audited via `assertAuditEvent`, AC#6 create a custom
template and preview through it, plus a UI leg `/reports` →
`/reports/query/samples` → Exportar download), then the RF013 block
(perform → list shows status/checksum, restore-test into the scratch db
with checksumVerified, policy PUT audited, non-admin 403, UI leg
`/backup` → Criar Backup). Then update `E2E_TRACEABILITY_PLAN.md`'s two
rows, run the full `test:e2e:docker` gate, and decide on the Wave 4
showcase reel (`e2e-showcase-video`) -- split it as its own issue under
#725 if the budget runs out first.
