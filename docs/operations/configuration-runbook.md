# Configuration runbook

Answers RNF006 C2 ("Documentar instalação, configuração, backup, restauração, APIs, eventos, outbox e troubleshooting."), its configuration part. Written 2026-11-13. It describes what the code does at this commit, nothing more; everything RNF006 C2 asks for configuration that the code does not do is listed under [Gaps](#7-gaps), never as a procedure. Tracking issue: #1472.

Sources: `api/backend/src/config/env.js`, `api/backend/src/config/validateEnv.js`, `api/backend/server.js`, `.env.production.example`, `.env.docker.example`, `.env.test.example`, `generate-env-production-secrets.sh`, `compose.prod.yml`, `frontend/Dockerfile.prod`, `api/backend/tests/architecture/env-declarations.arch.test.js`, `api/backend/tests/architecture/env-production-generator.arch.test.js`, `docs/decisions/2026-10-07-configuration-validation-and-governance-registry.md`, `docs/decisions/2026-10-07-security-configuration-releases.md`, `docs/decisions/2026-10-07-security-setting-catalog-and-approval.md`, `docs/decisions/2026-11-12-outbox-not-configurable.md`, `api/backend/src/models/ConfigurationRelease.js`, `api/backend/src/services/configurationRelease.service.js`, `api/backend/src/services/configurationValidation.service.js`, `api/backend/src/services/security.service.js`, `api/backend/src/interface/routes/security.routes.js`, `api/backend/src/infrastructure/middleware/rbac.js`, `api/backend/src/governance/securitySettingCatalog.js`, `api/backend/src/governance/invariants.js`.

Related: [install-runbook.md](install-runbook.md) (generating the env file, starting the stacks), [backup-restore-runbook.md](backup-restore-runbook.md) (the `BACKUP_*` settings and the backup policy), [../security/security-exceptions.md](../security/security-exceptions.md) (the switches that open a security exception; not restated here), [outbox-runbook.md](outbox-runbook.md).

## 1. Two layers

1. **The env file, read at process start.** `api/backend/src/config/env.js` calls `dotenv` and exports a plain object literal built from `process.env` when the module is first required. Every value is fixed for the life of the process. Under compose the variables come from `env_file` (`.env.docker` for `compose.dev.yml`, `.env.production` for `compose.prod.yml`); `compose.test.yml` sets its own inline. A change takes effect only in a new container (section 3).
2. **Configuration releases, changed at run time.** The security configuration (password, session, lockout, MFA and the other policy groups of `api/backend/src/governance/securitySettingCatalog.js`) is stored in MongoDB and changed through `/api/security/config` by an administrator, with no restart. Each change is a new `ConfigurationRelease` (section 4).

Nothing moves between the layers: no env variable is a configuration-release key, and no release changes an env variable.

## 2. Environment variables

### 2.1 How the code reads them

- `env.js` declares each variable it exports, and `env-declarations.arch.test.js` fails when a module reads `env.FOO` that `env.js` does not declare (its header: such a read is "simply `undefined` — forever, silently").
- A boolean flag is on only when set to `true` or `1`.
- A few variables are read straight from `process.env` and are not in `env.js`: `ALLOW_UNENCRYPTED_FILE_STORAGE`, `ALLOW_UNENCRYPTED_FIELD_STORAGE` (`validateEnv.js`), `WORKER_CONCURRENCY` (`api/backend/src/workers/import-worker.js`), `TZ` (`api/backend/src/services/scheduler.service.js`, `api/backend/src/infrastructure/services/TelemetryMonitor.js`), `TELEMETRY_INGEST_SECRET` (`api/backend/src/utils/machineIngestGate.js`), the `BOOTSTRAP_ADMIN_*` variables (`api/backend/src/scripts/createFirstAdmin.js`), and `TELEMETRY_MONITOR_CRON`, which `env.js` declares but `TelemetryMonitor` reads from `process.env` (`.env.production.example`).
- `.env.production.example` declares exactly the set `generate-env-production-secrets.sh` writes, which `env-production-generator.arch.test.js` pins.

### 2.2 What stops a production start

"Required in production" below means the code or `compose.prod.yml` refuses to start without it:

- `api/backend/server.js` (`startServer`) exits 1 when `MONGO_URI`, `JWT_SECRET`, `USER_ANON_SALT` or `CONSENT_SECRET` is blank, in every environment.
- `validateEncryptionAndHalt` (`validateEnv.js`), called from `startServer`, stops a `NODE_ENV=production` start when `ENCRYPTION_KEY` is blank or `ALLOW_UNENCRYPTED_FILE_STORAGE` or `ALLOW_UNENCRYPTED_FIELD_STORAGE` is `true`; elsewhere it only warns.
- `validateRedisEnv` (`validateEnv.js`) rejects a blank `REDIS_PASSWORD` outside `development` and `test` when the Redis host is not local; `compose.prod.yml` records that the worker treats that rejection as fatal.
- `compose.prod.yml` interpolates with `${NAME:?...}`, so `compose` itself refuses to start when any of `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `INFLUXDB_INIT_USERNAME`, `INFLUXDB_INIT_PASSWORD`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET`, `INFLUXDB_TOKEN` or `REDIS_PASSWORD` is blank.
- `validateAuditSigningAndWarn` (`validateEnv.js`) only warns when `AUDIT_MERKLE_SIGN_KEY_ID` or the signing key cannot be used; it does not stop the start.

### 2.3 By group

"Default" is the code's default in `env.js` when the variable is unset; "none" means the value is `undefined`. "Example" says whether `.env.production.example` sets it.

| Group | Variable | Required in production | Default | Example | Read by |
|---|---|---|---|---|---|
| Runtime | `NODE_ENV` | `compose.prod.yml` sets `production` | `development` | yes | `env.js` |
| Runtime | `PORT` | no | 3000 | no | `env.js`, `server.js` |
| Runtime | `FOUNDATION_READINESS_REQUIRED` | `compose.prod.yml` sets it on `backend` | off | no | `env.js`, `server.js` ([install-runbook.md](install-runbook.md), section 4.3) |
| Runtime | `SAMPLE_BARCODE_WINDOW_CLOSED` | no | off | no | `env.js` |
| MongoDB | `MONGO_URI` | yes (`server.js`) | none | generated | `env.js` |
| MongoDB | `MONGO_DB` | no | none | yes | `env.js`, `api/backend/src/database/mongo.js` |
| MongoDB | `MONGO_DB_NOVO` | no; "only scripts and reference-imports use it" | none | generated | `env.js` |
| MongoDB | `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD` | yes (`compose.prod.yml`) | none | username set, password generated | `compose.prod.yml` (`mongodb` init and healthcheck) |
| MongoDB | `COLL_*` | no | the collection name in `env.js` | no | `env.js`, `api/backend/src/config/collections.js` |
| Neo4j | `NEO4J_URI` | no, but without it the graph is off (example comment) | none | yes | `env.js` |
| Neo4j | `NEO4J_USERNAME`, `NEO4J_PASSWORD` | yes (`compose.prod.yml`) | none | username set, password generated | `env.js`, `compose.prod.yml` |
| Neo4j | `NEO4J_DATABASE` | no | `neo4j` | yes | `env.js` |
| Neo4j | `NEO4J_REQUIRED` | no | off | `true` | `env.js`, `server.js` |
| Neo4j | `LINEAGE_MODE` | no | `fail-open` | `fail-closed` | `env.js`, `server.js` |
| Neo4j | `NEO4J_CONNECT_MAX_RETRIES`, `NEO4J_CONNECT_INITIAL_DELAY_MS`, `NEO4J_CONNECT_MAX_DELAY_MS`, `NEO4J_CONNECT_FAILURE_COOLDOWN_MS` | no | 8, 1000, 15000, 30000 | no | `env.js` |
| Neo4j | `NEO4J_CANONICAL_SALT` | no | `GRAPH_PSEUDONYMIZATION_SALT`, else `USER_ANON_SALT` | no | `env.js` |
| Neo4j | `NEO4J_RETRY_QUEUE_KEY`, `NEO4J_RETRY_INTERVAL_MS`, `NEO4J_RETRY_BATCH_SIZE`, `NEO4J_RETRY_MAX_ATTEMPTS` | no | none | no | `env.js` |
| Graph outbox | `GRAPH_OUTBOX_BATCH_SIZE`, `GRAPH_OUTBOX_MAX_ATTEMPTS`, `GRAPH_OUTBOX_LEASE_MS`, `GRAPH_OUTBOX_RETRY_BACKOFF_MS` | no | 100, 8, 300000, 1000 | no | `env.js` ([outbox-runbook.md](outbox-runbook.md)) |
| InfluxDB | `INFLUXDB_URL` | no; "Telemetry writes have no endpoint without this" | none | yes | `env.js` |
| InfluxDB | `INFLUXDB_TOKEN`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET` | yes (`compose.prod.yml`) | none | org and bucket set, token generated | `env.js`, `compose.prod.yml` |
| InfluxDB | `INFLUXDB_INIT_USERNAME`, `INFLUXDB_INIT_PASSWORD` | yes (`compose.prod.yml`) | none | username set, password generated | `compose.prod.yml` (`influxdb` setup) |
| Redis | `REDIS_PASSWORD` | yes (`compose.prod.yml`, `validateEnv.js`) | none | generated | `env.js`, `validateEnv.js`, `compose.prod.yml` (`--requirepass`) |
| Redis | `REDIS_URL`, `REDIS_HOST`, `REDIS_PORT` | `REDIS_URL`, or both `REDIS_HOST` and `REDIS_PORT` (`validateEnv.js`) | none | yes | `env.js`, `api/backend/src/config/redis.js`, `validateEnv.js` |
| Redis | `REDIS_USERNAME` | no | `default` | no | `env.js` |
| Redis | `REDIS_TLS` | no | off | `false` | `env.js` |
| Workers | `WORKER_CONCURRENCY` | no | see `import-worker.js` | `1`, with the reason in the example | `import-worker.js` |
| Auth | `JWT_SECRET` | yes (`server.js`) | none | generated | `env.js` |
| Auth | `JWT_REFRESH_SECRET` | no start check | none | generated | `env.js` |
| Auth | `CONSENT_SECRET` | yes (`server.js`) | none | generated | `env.js` |
| Auth | `AUTH_RATE_LIMIT_RELAXED`, `CONSENT_RATE_LIMIT_RELAXED` | no; an explicit opt-in that only the development stack sets (`env.js` comment) | off | no | `env.js` |
| Encryption | `ENCRYPTION_KEY` | yes (`validateEncryptionAndHalt`) | none | generated | `env.js`, `validateEnv.js` |
| Encryption | `ENCRYPTION_KEY_ID` | no | `default` in `validateEnv.js` | yes | `env.js`, `api/backend/src/config/keyRegistry.js` |
| Encryption | `ENCRYPTION_KEY_PREVIOUS`, `ENCRYPTION_KEY_PREVIOUS_ID` | no; the rotation slot, blank by design | none | blank | `env.js`, `validateEnv.js` |
| Encryption | `ALLOW_UNENCRYPTED_FILE_STORAGE`, `ALLOW_UNENCRYPTED_FIELD_STORAGE` | must not be `true` in production (`validateEncryptionAndHalt`) | off | no | `validateEnv.js` |
| Pseudonymization | `USER_ANON_SALT` | yes (`server.js`) | none | generated | `env.js` |
| Audit chain | `AUDIT_RFC3161_MODE`, `AUDIT_RFC3161_TSA_URL` | no start check; without the URL every audit event stays pending a timestamp (example comment) | none | yes | `env.js`, `api/backend/src/services/rfc3161-adapter.service.js` |
| Audit chain | `AUDIT_RFC3161_TSA_AUTH_TOKEN` | no | none | blank | `env.js` |
| Audit chain | `AUDIT_EXTERNAL_WITNESS_URL` | no | none | yes | `env.js` |
| Audit chain | `AUDIT_EXTERNAL_WITNESS_PUBLIC_KEY` | no; `env.js` records it as inert | none | blank | `env.js` |
| Audit chain | `AUDIT_MERKLE_SIGN_KEY_ID`, `AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE`, `AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON`, `AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE` | no start check; warned by `validateAuditSigningAndWarn` | none | key id set, file and registry generated | `env.js`, `validateEnv.js` |
| URLs | `FRONTEND_URL` | no start check; `NotificationService` throws without it | none | blank | `env.js`, `api/backend/src/services/NotificationService.js` |
| URLs | `ALLOWED_ORIGINS`, `CORS_ALLOW_ALL` | no | none, off | blank, `false` | `env.js`, `api/backend/app.js` |
| URLs | `TRUST_PROXY` | no | `0` | `0` | `env.js`, `api/backend/app.js` |
| Host ports | `BACKEND_HOST_PORT`, `FRONTEND_HOST_PORT` | no | 3000, 80 in `compose.prod.yml` | yes | `compose.prod.yml` |
| Storage | `UPLOAD_DIR`, `STORAGE_DIR` | no start check; the code defaults are not writable in the read-only production container (example comment) | none | `/data/uploads`, `/data/storage` | `env.js` |
| Storage | `OBJECT_STORE_DRIVER`, `OBJECT_STORE_S3_*` | no | none: unset keeps the filesystem store | no | `env.js` |
| Storage | `MALWARE_SCAN_DRIVER` | no | none: unset records not-available | no | `env.js` |
| Backup | `BACKUP_DIR`, `RESTORE_SCRATCH_DIR`, `BACKUP_CRON`, `BACKUP_RETENTION_DAYS`, `RESTORE_TEST_CRON`, `BACKUP_OFFSITE_S3_*` | no | see [backup-restore-runbook.md](backup-restore-runbook.md) | `BACKUP_DIR` set, the rest commented | `env.js` |
| Schedules | `TZ` | no | America/Sao_Paulo for the cron schedules, when `TZ` is unset | commented | `scheduler.service.js`, `TelemetryMonitor.js` |
| Schedules | `RETENTION_SWEEP_CRON`, `TEMP_MONITOR_CRON`, `TEMP_STALE_MINUTES`, `PLATFORM_ALERT_CRON` | no | the scheduler's own, shown commented in the example | commented | `env.js`, `scheduler.service.js` |
| Alerts | `ALERT_HTTP_ERROR_RATE`, `ALERT_HTTP_P95_MS`, `ALERT_QUEUE_BACKLOG` | no | shown commented in the example | commented | `env.js` |
| Alerts | `ALERT_EMAIL_TO`, `RESEND_API_KEY`, `EMAIL_FROM` | no | none | blank | `env.js` |
| Telemetry | `TELEMETRY_BINDING_MODE` | no | `enforce` | `enforce` | `env.js` |
| Telemetry | `TELEMETRY_MONITOR_CRON`, `TELEMETRY_CRITICAL_TEMP`, `TELEMETRY_CRITICAL_DURATION_HOURS`, `TELEMETRY_LOOKBACK_HOURS`, `TELEMETRY_TRIGGER_COOLDOWN_MINUTES`, `TELEMETRY_MIN_TEMP_ALERT`, `TELEMETRY_MAX_TEMP_ALERT` | no | none | cron commented | `env.js` |
| Telemetry | `TELEMETRY_INGEST_SECRET` | no; unset closes the machine-ingest routes | none | blank | `api/backend/src/utils/machineIngestGate.js`, the gate the IoT and temperature ingest routes use |
| Telemetry | `MQTT_ENABLED`, `MQTT_URL`, `MQTT_TLS_ENABLED`, and the other `MQTT_*` of `env.js` | no | off, none | `false`, blank, `true` | `env.js` |
| Integrations | `ALLOW_CLOUD_INTEGRATIONS`, `ALLOW_EXTERNAL_TERMINOLOGY_SYNC`, `ALLOW_EXTERNAL_HPO_LOOKUP`, `ALLOW_EXTERNAL_DRUG_LOOKUP` | no | off | `false` | `env.js` |
| Bootstrap | `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_TEMP_PASSWORD`, `BOOTSTRAP_ADMIN_FORCE_RESET` | only to run `createFirstAdmin.js` | none; the reset is forced unless `false` | deliberately absent | `createFirstAdmin.js` ([install-runbook.md](install-runbook.md), section 5) |
| Test only | `ENABLE_TEST_SUPPORT_ROUTES`, `TEST_SUPPORT_SECRET` | must stay unset ("DELIBERATELY ABSENT, do not add", `.env.production.example`) | none | absent | `api/backend/src/utils/testSupportGate.js`, `api/backend/src/utils/machineIngestGate.js` |
| Frontend build | `VITE_API_BASE_URL` | no | empty, the runtime hostname fallback (`frontend/Dockerfile.prod`) | absent | `frontend/Dockerfile.prod` (build `ARG`) |

`.env.docker.example` sets most of the same names for the development stack, plus the `*_HOST_PORT` overrides, the `VITE_HMR_*` dev-server settings and the four `BOOTSTRAP_ADMIN_*`. `.env.test.example` is the `--env-file` CI passes with `compose.test.yml`.

## 3. Which services restart after an env change

`env.js` is read once per process, so a changed `.env.production` reaches a service only when compose creates a new container for it. Apply it with

```bash
npm run compose:prod:up
```

The services that read `.env.production` as `env_file` in `compose.prod.yml`, and so pick a change up when recreated: `backend`, `worker`, `neo4j-projection-worker`, the one-shot jobs `foundation` and `essential-references` (which run again), and `frontend`, where it is inert: its runtime is `nginx` serving a static bundle (`.env.production.example`, `VITE_*` note).

The database services take their credentials from the same file by interpolation, into their init variables (`MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`, `NEO4J_AUTH`, `DOCKER_INFLUXDB_INIT_*`) and Redis's `--requirepass`. `generate-env-production-secrets.sh` refuses to overwrite an existing file so that "a re-run cannot mint new credentials over the volumes a running stack was initialised with": changing a database credential in the file does not change the one stored in an existing volume. See [Gaps](#7-gaps).

`compose.prod.yml` passes no build `args:` to `frontend`, so `VITE_API_BASE_URL` keeps its empty default in the production image whatever the env file says.

## 4. Configuration releases

### 4.1 What they are

A `ConfigurationRelease` (`api/backend/src/models/ConfigurationRelease.js`, collection `COLL_CONFIGURATION_RELEASES`, default `configurationReleases`) is one immutable snapshot of the security configuration: `configurationReleaseId`, `profileId`, `semanticVersion` (`<n>.0.0`), `checksum` (`sha256:` over the canonical JSON of `settings`), `effectivePeriod`, `approvedBy`, `approvedAt`, `supersedesId`, `rollbackTargetId` and `status` (`draft|candidate|approved|active|superseded|retired`). A release's settings and checksum are never rewritten; only its status and `effectivePeriod` move. A partial unique index allows one `active` release per profile (`docs/decisions/2026-10-07-security-configuration-releases.md`). The profile is `security-configuration`, scoped to the environment `NODE_ENV` (`security.service.js`). The `security_config` document (`_id: 'main'`) stays the read model every reader keys on and names the active `configurationReleaseId`.

Every key has a catalog entry (`securitySettingCatalog.js`): type, scope, allowed values, default, dependencies, owner and validity (`docs/decisions/2026-10-07-security-setting-catalog-and-approval.md`).

### 4.2 The routes and the role

`api/backend/src/interface/routes/security.routes.js`, mounted at `/api/security` (`api/backend/app.js`). Every route needs an authenticated user (`authenticate`) at hierarchy level 4, the administrator (`requireRole(4)`, `api/backend/src/infrastructure/middleware/rbac.js`); anyone else gets 401 or 403.

| Route | What it does |
|---|---|
| `GET /api/security/config` | The configuration in force. |
| `GET /api/security/config/catalog` | The setting catalog with its version. |
| `GET /api/security/config/releases` | This environment's releases, newest first; `limit` 1 to 200, default 50. |
| `PUT /api/security/config` | Proposes, validates, approves and activates a change, in one call (4.3). |
| `POST /api/security/config/rollback` | Body `{ configurationReleaseId }`: rolls back to that release (4.4). |

### 4.3 Propose, validate, approve, activate

One `PUT /api/security/config` does all four (`security.service.js` `updateConfig`, `configurationValidation.service.js` `activateValidated`, `configurationRelease.service.js` `activate`):

1. **Propose.** The body is the candidate. Retention-governed keys are dropped, since the active RetentionPolicy sets them; a fixed key sent at its fixed value is dropped too.
2. **Validate.** A `ConfigurationValidationRun` (collection `COLL_CONFIGURATION_VALIDATION_RUNS`) records the structural, semantic, dependency and security gates and one result per governance invariant. A failed run refuses the change: 422 when an invariant was broken, 400 when another gate failed, with `configurationValidationRunId`, `violatedInvariants` and `violations` in the response. The candidate is kept as a `draft` release that was never active and cannot be rolled back to; a fixed key sent at another value also appends a `violation_attempted` event.
3. **Approve.** There is no separate approval step: the administrator who saves is recorded as `approvedBy`, and `proposed`, `approved` and `activated` `ConfigurationChangeEvent`s (collection `COLL_CONFIGURATION_CHANGE_EVENTS`) are appended in that order. `docs/decisions/2026-10-07-security-setting-catalog-and-approval.md` records why no second approver is built.
4. **Activate.** The previous active release becomes `superseded` with its `effectivePeriod` closed, the new one is inserted `active`, and `security_config` follows it. When another change was activated at the same moment the call answers 409 and the configuration in force is untouched. The first save also records the configuration already in force as a baseline release, so the first change can be rolled back. A change that tightens the session policy revokes existing sessions (`security.service.js`, `revokeAllSessionsForPolicyChange`).

### 4.4 Roll back via `rollbackTargetId`

`POST /api/security/config/rollback` (`security.service.js` `rollbackConfig`, `configurationRelease.service.js` `rollbackTarget`):

- The target must be one of this profile's releases (else 404), not a `draft` and not the `active` one (else 409).
- The rollback is a new release carrying a copy of the target's settings, with `rollbackTargetId` naming the target; the old row is never reactivated. It goes through the same validation, events and session revocation as a `PUT`, and its event is `rolled_back`, whose `rollbackOf` names the activation it undoes.

To find the target's id, read `GET /api/security/config/releases`.

## 5. What no setting can change

- **The governance invariants.** `api/backend/src/governance/invariants.js` holds them; the Foundation job registers them as a `GovernanceInvariantCatalog` that is never rewritten (`docs/decisions/2026-10-07-configuration-validation-and-governance-registry.md`). Four fix catalog keys: `INV-AUDIT-001`, `INV-PRIVACY-001`, `INV-CONSENT-001`, `INV-IDENTITY-001`; a fixed key sent at another value is refused (4.3). `INV-SCOPE-001` refuses any key outside the catalog.
- **The outbox.** No catalog key addresses it, so `outbox` at the top level or inside a group fails the structural gate and `INV-SCOPE-001`, answers 422, records a `violation_attempted` event and keeps the candidate as a draft; the active release does not move (`docs/decisions/2026-11-12-outbox-not-configurable.md`). Its batch, lease and retry tuning are the `GRAPH_OUTBOX_*` env variables of section 2.3, read at start ([outbox-runbook.md](outbox-runbook.md)).
- **The canonical model release.** The `CanonicalModelRelease` the Foundation job registers is never rewritten; a changed checksum fails the `governance-registry` readiness gate.
- **Anything outside the security profile.** Releases exist only for the `security-configuration` profile; every other setting is an env variable (section 2).

## 6. Exceptions

The settings that relax a security control and require a registered exception before they are set outside local development (among them `ALLOW_UNENCRYPTED_FILE_STORAGE`, `ALLOW_UNENCRYPTED_FIELD_STORAGE` and `CORS_ALLOW_ALL`) are listed, with their effect, in [../security/security-exceptions.md](../security/security-exceptions.md).

## 7. Gaps

| Criterion | What the code does today | Gap |
|---|---|---|
| RNF006 C2, configuration: run-time change of env settings | Every env variable is read once at process start (`env.js`). | Not implemented: no env setting changes without recreating the container; there is no reload. |
| RNF006 C2, configuration: database credential rotation | The database containers take their credentials from `.env.production` at initialisation; the generator refuses to overwrite the file. | Not implemented: no script or procedure rotates `MONGO_ROOT_PASSWORD`, `NEO4J_PASSWORD`, `INFLUXDB_INIT_PASSWORD`, `INFLUXDB_TOKEN` or `REDIS_PASSWORD` on a running stack. |
| RNF006 C2, configuration: releases beyond security | Configuration releases cover only the `security-configuration` profile. | Not implemented: no release, validation run or rollback for any other setting; those are env variables without history. |
| RNF006 C2, configuration: separate approval | Saving a change approves and activates it; the saver is `approvedBy`. | Not implemented: no separate approval step and no second approver (a decision, `2026-10-07-security-setting-catalog-and-approval.md`). |
| RNF006 C2, configuration: start-time checks | `server.js` and `validateEnv.js` stop a start on the variables of section 2.2. | Not implemented: no start check for `FRONTEND_URL`, `NEO4J_URI`, `INFLUXDB_URL`, `AUDIT_RFC3161_TSA_URL`, `UPLOAD_DIR`, `STORAGE_DIR` or `BACKUP_DIR`; a stack missing one starts and fails at first use. |
| RNF006 C2, configuration: frontend build settings | `frontend/Dockerfile.prod` takes `VITE_API_BASE_URL` as a build `ARG`. | Not implemented: `compose.prod.yml` passes no build args to `frontend`, so the production image always builds with the empty default. |
