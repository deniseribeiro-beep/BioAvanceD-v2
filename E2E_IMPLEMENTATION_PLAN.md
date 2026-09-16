# Plan: real backend+frontend Playwright e2e coverage for every RF/RNF

## Context

`E2E_TRACEABILITY_PLAN.md` (repo root, written this session) already maps
all 29 functional requirements (RF001-RF029, doc v3.0.0 — RF030 does not
exist despite being referenced in the doc's own prose, see that file's
note) and 32 non-functional requirements to 6 proposed spec files, with
a wave-by-wave sequencing. That document answers *what* to test and in
what order. This plan answers *how to actually build it* — grounded in
the real current state of the code, not the dated (2026-07-22) gap
analysis docs alone.

Two things changed the shape of this plan versus a naive reading of the
traceability doc:

1. **Direct code exploration surfaced real drift from the docs.** The
   backend is more built-out than `dict-07/08` suggested in places
   (rich `sample.routes.js` with MIABIS compliance, HL7/FHIR/CDA file
   export, barcode symbology; a real `reference-imports/` importer
   script; rich audit infra with RFC3161 timestamping and external
   witnesses) — and *less* built-out in others that matter for this
   plan specifically: **no Playwright e2e job runs in CI today** (the
   project's testing conventions' "3 CI jobs" description
   is stale — current `ci-pipeline.yml` has one job, never invokes
   Playwright), and **the real-backend login path is dead scaffolding**
   (`compose.test.yml` sets `PLAYWRIGHT_USE_REAL_LOGIN`/`TEST_USER`/
   `TEST_PASS`, but nothing reads that env var, there's no seed script
   producing that user, and the `playwright-runner` service's `npm run
   test:e2e` command doesn't exist in `frontend/package.json`).
2. **User decisions locked in this session:** build real backend+
   frontend integration fresh rather than retrofit the mocked-only
   pattern (mocking stays available for fast local iteration but is no
   longer the bar for "done"); treat legacy/testid-less frontend pages
   as fair game to rebuild rather than patch; **CI wiring and the full
   Docker milestone are explicitly the *next* milestones, not this
   one** — this plan's job is to make `npm run test:e2e:docker` (run
   manually / from a dev shell) prove every requirement against the
   real stack, not to wire it into CI yet.

## Scope boundary

**In scope:** writing real, backend+frontend-integrated Playwright specs
(plus whatever backend/frontend implementation work a spec needs in
order to test something real, not a legacy stand-in) for all 29 RF and
the RNFs that fold into a spec (bucket A in the traceability doc). The
new e2e infrastructure (seed script, real-login helper) that makes real
integration possible at all.

**Out of scope (explicitly deferred, per user):** wiring any of this
into `ci-pipeline.yml`; the separate "full Docker milestone" (this plan
assumes `npm run test:e2e:docker` / `compose.test.yml` as the manual
verification path, not a CI-automated one); RNF buckets B/C from the
traceability doc (load testing, accessibility audits, ISO process
alignment — different tooling, different milestone); RF-FUT-001 (out of
scope by the doc's own design).

## Phase 0 — Fix the real-backend e2e foundation (build once, blocks everything else)

**Status: done** (2026-07-28, `test/e2e-real-backend-foundation`). Everything
after this phase can now assume a working real login + a known seeded test
identity, verified against the real `compose.test.yml` stack. What actually
shipped, including drift from the original plan below:

1. **`admin:create-first` produces the seeded test user.**
   `createFirstAdmin.js` actually requires *four* env vars, not the two
   originally assumed — `BOOTSTRAP_ADMIN_NAME`/`BOOTSTRAP_ADMIN_EMAIL` in
   addition to `BOOTSTRAP_ADMIN_USERNAME`/`BOOTSTRAP_ADMIN_TEMP_PASSWORD`.
   All four are in `compose.test.yml`'s `&test-env` anchor now (`admin` /
   `Admin@123`, matching `TEST_USER`/`TEST_PASS`, plus a placeholder
   name/email). A new one-shot `admin-bootstrap-test` service runs `npm run
   admin:create-first` against `backend-app-test` once it's healthy — run
   explicitly via `docker compose run --rm admin-bootstrap-test` (not
   included in the `up -d --wait` service list, same pattern as
   `backend-unit-runner`).
2. **`compose.test.yml`'s `playwright-runner` service fixed, with a
   deviation from the original plan.** Bind-mounting the whole repo into
   the stock `mcr.microsoft.com/playwright` image (as originally planned)
   risks shipping Windows-resolved native optional-dependency binaries into
   a Linux container. Built a small dedicated `Dockerfile.playwright`
   instead (fresh `npm ci` inside the image, `COPY` only
   `playwright.config.ts` + `tests/e2e`), matching the pattern every other
   custom service in this file already uses. Builds and is wired to the
   internal hostnames; **not yet run end-to-end** — the actual per-spec
   verification path (below) is host-based, and wiring this container into
   CI is still the explicitly-deferred next milestone. `PLAYWRIGHT_USE_REAL_LOGIN`
   removed (dead — `realAuth.ts` supersedes it).
3. **`tests/e2e/helpers/realAuth.ts` built** as planned: `realLogin()` hits
   `POST /api/auth/login` for a real token, `seedRealAuth()`/`realAuthLogin()`
   seed it via `addInitScript` mirroring `mockAuth.ts`.
4. **`auth-access-security.spec.ts` built**, RF001 happy path drives the
   real login form once via `LoginPage.tsx`'s existing testids (already
   present, not one of the legacy testid-less pages), plus a wrong-password
   rejection case.
5. **`tests/e2e/helpers/assertAuditEvent.ts` built — leaf-count diff only,
   not the full chain-verify endpoint.** `POST /api/audit/verify` (the
   Merkle root + RFC3161 + witness chain `audit-e2e-real.js` exercises)
   depends on a tree head from the once-daily anchor job
   (`daily-merkle.job.js`, ~02:30 UTC) — an event created moments ago has no
   anchored tree head yet, so it's unusable for a per-spec assertion. Real
   actions mirror into `audit_events`/the `logs` collection synchronously
   (`log.service.js`'s `ingestLogRecord` call) regardless, so
   `GET /api/audit/dashboard/stats/:date`'s live-recomputed `leafCount` is
   the right per-spec signal — confirmed real (not a false-pass) by
   temporarily requiring an impossible delta and watching it fail before
   reverting.

**Two things the original plan didn't anticipate, needed for the
host-based verification workflow below to work at all:**

- `backend-app-test`/`frontend-app-test` needed `ports: ["3000:3000"]` /
  `["5173:5173"]` published to the host — they only had `expose:` before,
  unreachable from a host-run Playwright process.
- `frontend-app-test`'s `VITE_API_BASE_URL` had to change from
  `http://backend-app-test:3000/api` (compose-internal hostname) to
  `http://localhost:3000/api` — the browser that loads the app is the
  *host* browser (via the published 5173 port), which can't resolve
  compose-internal service names at all.

**Two pre-existing infra bugs found and fixed while bringing the full
stack up for the first time** (nothing here had ever been exercised
end-to-end before this session): `infra/tsa`/`infra/witness`'s
`entrypoint.sh` were checked out with CRLF line endings on Windows,
breaking their shebang in the Linux containers (fixed: `.gitattributes`
`*.sh text eol=lf`); `frontend-app-test`'s `npm ci` intermittently omits
`@rollup/rollup-linux-x64-musl` under Docker Desktop for Windows even
though CI doesn't hit it with the same lockfile+image — mitigated with a
defensive fallback install in `frontend/Dockerfile.dev`, root cause not
identified, tracked as issue #286.

## Phase 1+ — Per-wave spec build (reuses the traceability doc's grouping/sequencing)

For each RF in a wave (waves and RF→file grouping already defined in
`E2E_TRACEABILITY_PLAN.md` — this plan doesn't redefine them, it defines
how to execute them for real):

1. **Confirm current backend truth first, don't trust the dated gap
   docs blindly.** `dict-07_ALINHAMENTO_CODIGO.md`/`dict-08_MAIN_GAPS.md`
   are a snapshot from 2026-07-22; this session already found drift in
   both directions. Grep/read the actual route+service file for the RF
   before deciding whether it needs new backend work or just a spec.
2. **If the backend already matches the canonical model:** write the
   spec directly against it — real backend, `realAuth.ts`, happy path +
   at least one rejection case from the RF's Critérios de aceitação +
   the audit assertion.
3. **If the frontend page is legacy/testid-less** (confirmed list this
   session: `Dashboard.tsx`, `LogsPage.tsx`, `ReportsPage.tsx`,
   `BackupPage.tsx`, `QualityDescriptionPage.tsx`, `SampleLabelPage.tsx`,
   `SampleChainPage.tsx`, `SampleMovementsPage.tsx` — all 0 testids):
   per this session's decision, rebuild the page's markup as part of
   writing its first real spec — add `data-testid`s generously, don't
   try to reverse-engineer brittle role/text selectors onto stale
   markup. This is scoped to what the spec needs to select and assert
   on, not a full visual redesign.
4. **If the backend has a real gap against the target model** (the RED
   items: RF005 `ParticipantIdentity` segregation, RF010
   `ConsentTemplate`/`Consent` split, RF022 Foundation Data Pipeline
   one-shot bootstrap, RF028 reference-data importers beyond the
   existing dry-run skeleton in `scripts/reference-imports/`): build the
   real implementation as part of this wave, then the spec proves it.
   RF022 and RF028 are large enough (each is effectively its own
   subsystem — one-shot bootstrap job with a coverage gate; a
   multi-source terminology import pipeline with staging/promotion/
   rollback) that **when that wave starts, run a focused design pass
   for that specific RF before writing code** — this plan intentionally
   does not pre-design those two subsystems in full; forcing that detail
   now would be guessing ahead of the actual current state at
   implementation time.
5. **Update `E2E_TRACEABILITY_PLAN.md`'s Status/Wave columns** in the
   same commit as the spec that changes them — it's the living tracker,
   same discipline as `COVERAGE_NOTES.md`.
6. **File a GitHub issue for any RED gap the moment its test proves the
   gap** (per the project's conventions) — the failing test is the
   evidence, link it in the issue.

## Spec file plan (unchanged from the traceability doc, restated for reference)

| Spec file | RFs | Real backend needed for |
|---|---|---|
| `auth-access-security.spec.ts` | RF001-003, RF014 | Login, RBAC 403s, session revocation, MFA |
| `participant-consent-studies.spec.ts` | RF004, RF005, RF010, RF020, RF021 | Participant/Identity persistence, Consent versioning |
| `specimen-quality-inventory.spec.ts` | RF004(shared), RF006, RF016-019, RF025, RF026 | Custody events, SPREC/RCS scoring, quarantine |
| `interop-monitoring.spec.ts` | RF009, RF011, RF015 | Telemetry persistence (InfluxDB), FHIR conversion |
| `scientific-data-access.spec.ts` | RF007, RF008, RF024, RF027 | File upload/checksum, access-request workflow |
| `pipeline-continuity.spec.ts` | RF013, RF022, RF023, RF028, RF029 | Outbox → Neo4j projection, backup, bootstrap |

`RF012` has no dedicated file — `assertAuditEvent.ts` is called from
every spec above instead (per the diagrams' `«include»` pattern).

## Verification

- Per spec, while writing: `npx playwright test tests/e2e/<spec>.spec.ts --reporter=list` against the real stack — bring it up with `docker compose --env-file .env.test.example -f compose.test.yml up -d --wait mongodb-test neo4j-test redis-test mqtt-test influxdb-test smtp-test tsa-test witness-test backend-app-test worker-test frontend-app-test`, seed the admin with `docker compose --env-file .env.test.example -f compose.test.yml run --rm admin-bootstrap-test`, then either `npm run test:e2e:docker` filtered to that file, or set the same env vars directly (`PLAYWRIGHT_BASE_URL=http://localhost:5173 PLAYWRIGHT_API_BASE_URL=http://localhost:3000 PLAYWRIGHT_SKIP_WEBSERVER=1 TEST_USER=admin TEST_PASS=Admin@123`) before `npx playwright test <file> --reporter=list` — `node_modules/.bin` isn't always on `PATH` in a Git Bash session, so a bare `cross-env ...` invocation (as opposed to via an `npm run` script) can fail with `command not found`.
- Confirm the audit assertion actually fires (not a false-pass) by
  temporarily breaking it once per new helper usage — same "verify
  before trusting" discipline as any new assertion.
- End of each wave: run the full new-spec set together once
  (`--reporter=dot`, per the project's testing conventions' context-economy rule) against a fresh stack (`compose down --volumes` between runs so seed state doesn't leak across waves).
- Don't run the backend's own Docker unit-test gate
  (`backend-unit-runner`) as part of this work unless backend code
  changed that session — it's a separate, already-passing gate.

## Skills/docs that will need updating once this lands

As last session, flag these upstream rather than editing the shared
conventions directly:
- The project's testing conventions' "CI map" section is stale (claims
  3 jobs; there's 1, and it doesn't run Playwright) — needs a rewrite
  once this phase's findings are final, not before (it may change again
  once the CI-wiring milestone lands).
- Once `realAuth.ts` exists, the Playwright conventions' "no real-login
  global setup" note is resolved — update it to point at the new helper.
