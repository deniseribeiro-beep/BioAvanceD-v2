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
   `bioavanced-v2-testing-conventions` skill's "3 CI jobs" description
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

Everything after this phase assumes a working real login + a known
seeded test identity. Today neither exists. Concrete fixes, in order:

1. **Make `admin:create-first` produce the seeded test user.**
   `api/backend/src/scripts/createFirstAdmin.js` already exists and does
   the right thing (creates a user with hashed password, unique index)
   but reads `BOOTSTRAP_ADMIN_USERNAME`/`BOOTSTRAP_ADMIN_TEMP_PASSWORD`,
   not `TEST_USER`/`TEST_PASS`. Add those two env vars to
   `compose.test.yml`'s `&test-env` anchor (`BOOTSTRAP_ADMIN_USERNAME:
   admin`, `BOOTSTRAP_ADMIN_TEMP_PASSWORD: Admin@123`, matching the
   `TEST_USER`/`TEST_PASS` the `playwright-runner` service already
   expects), and add a compose step/service that runs `npm run
   admin:create-first` against `backend-app-test` once it's healthy,
   before Playwright runs. Reuse this script — don't write a new one.
2. **Fix `compose.test.yml`'s `playwright-runner` service.** It's
   currently configured for a frontend-local e2e setup that doesn't
   exist (`working_dir: /workspace/frontend`, mounts only `./frontend`,
   runs `npm run test:e2e` which isn't a defined script there). Per
   `playwright-specs`' own config-location rule, the config belongs at
   the repo root (already correct — `playwright.config.ts` + spec dir
   `tests/e2e/` are both root-level and already working for the mocked
   suite). Change the service to mount the whole repo, `working_dir:
   /workspace`, and run the existing `npm run test:e2e:docker` script
   pointed at the compose network's internal hostnames
   (`PLAYWRIGHT_BASE_URL=http://frontend-app-test:5173`,
   `PLAYWRIGHT_API_BASE_URL=http://backend-app-test:3000` — already set
   correctly in the service's `environment:` block, just needs the
   working dir/command fixed to match). Remove the dead
   `PLAYWRIGHT_USE_REAL_LOGIN` var once the real-login helper below
   makes it redundant, or wire it through if a spec-level conditional
   ends up wanting it.
3. **New helper: `tests/e2e/helpers/realAuth.ts`.** Mirrors
   `mockAuth.ts`'s mechanism (seed `localStorage` via
   `page.addInitScript` before `page.goto`) but the token is real: call
   `POST /api/auth/login` via Playwright's `request` fixture with
   `TEST_USER`/`TEST_PASS`, take the real token from the response (same
   `body.data.token` shape `backend-integration.spec.ts` already
   unwraps), and seed it. Fast (no UI round-trip) but genuinely
   authenticated against the real backend — this becomes the `beforeEach`
   for every new spec except the auth spec itself.
4. **The auth spec drives a real UI login once.** RF001's happy path
   *is* the login form — `auth-access-security.spec.ts`'s first test
   should `page.goto('/login')` and actually type into the real form
   (see `frontend/src/views/LoginPage.tsx` for current field
   names/testids — check before assuming) rather than only using the
   token-seeding shortcut, so the real flow through `auth.routes.js`'s
   `/login` handler is genuinely exercised end-to-end at least once.
5. **New helper: `tests/e2e/helpers/assertAuditEvent.ts`.** Backs RF012
   and the "assert the audit trail" cross-cutting rule from the
   traceability doc. Hit the real endpoints found in
   `api/backend/src/interface/routes/audit.routes.js`: `GET
   /api/audit/dashboard/stats/:date` (event count for a date) before and
   after the action under test, or `POST /api/audit/verify` to confirm
   chain integrity. `api/backend/scripts/audit-e2e-real.js` is a working
   reference for how the real audit chain (Merkle root + RFC3161 TSA +
   external witness, services already running in `compose.test.yml` as
   `tsa-test`/`witness-test`) gets exercised for real — read it before
   building the helper, don't reinvent the signing-key/env setup it
   already solved.

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
   gap** (per `bioavanced-v2-conventions`) — the failing test is the
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

- Per spec, while writing: `npx playwright test tests/e2e/<spec>.spec.ts --reporter=list` against the real stack (`npm run compose:up` equivalent for the test stack, i.e. `docker compose --env-file .env.test.example -f compose.test.yml up -d --wait mongodb-test neo4j-test redis-test influxdb-test smtp-test tsa-test witness-test backend-app-test worker-test frontend-app-test`, then run the seed step, then `npm run test:e2e:docker` filtered to that file).
- Confirm the audit assertion actually fires (not a false-pass) by
  temporarily breaking it once per new helper usage — same "verify
  before trusting" discipline as any new assertion.
- End of each wave: run the full new-spec set together once
  (`--reporter=dot`, per `bioavanced-v2-testing-conventions`' context-economy rule) against a fresh stack (`compose down --volumes` between runs so seed state doesn't leak across waves).
- Don't run the backend's own Docker unit-test gate
  (`backend-unit-runner`) as part of this work unless backend code
  changed that session — it's a separate, already-passing gate.

## Skills/docs that will need updating once this lands

Same Rule 0 situation as last session — flag via a pack-repo issue
(`DyeAllPies/dyeallpies-skills-pack`), don't edit the junctioned skill
directly:
- `bioavanced-v2-testing-conventions`'s "CI map" section is stale (claims
  3 jobs; there's 1, and it doesn't run Playwright) — needs a rewrite
  once this phase's findings are final, not before (it may change again
  once the CI-wiring milestone lands).
- Once `realAuth.ts` exists, `playwright-specs`' "no real-login global
  setup" note is resolved — update it to point at the new helper.
