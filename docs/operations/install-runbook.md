# Install runbook

Answers RNF006 C2 ("Documentar instalação, configuração, backup, restauração, APIs, eventos, outbox e troubleshooting."), its installation part. Written 2026-11-13. It describes what the code does at this commit, nothing more; everything RNF006 C2 asks for an installation that the code does not do is listed under [Gaps](#8-gaps), never as a procedure. Tracking issue: #1472.

Sources: `README.md` (Bootstrap and Seeds, Local Development), `package.json`, `api/backend/package.json`, `compose.yml`, `compose.dev.yml`, `compose.prod.yml`, `compose.test.yml`, `compose.lab.yml`, `generate-env-production-secrets.sh`, `generate-env-docker-secrets.sh`, `.env.production.example`, `.env.docker.example`, `api/backend/Dockerfile.prod`, `frontend/Dockerfile.prod`, `infra/tsa/Dockerfile`, `api/backend/src/foundation/readiness.js`, `api/backend/server.js`, `api/backend/src/scripts/createFirstAdmin.js`, `docs/decisions/2026-10-23-compose-ports-loopback.md`, `scripts/start-local-stack.ps1`, `scripts/stop-local-stack.ps1`, `.github/workflows/ci-pipeline.yml`, `frontend/nginx.conf`.

Related: [configuration-runbook.md](configuration-runbook.md) (what each variable does and how run-time settings change), [backup-restore-runbook.md](backup-restore-runbook.md), [troubleshooting-runbook.md](troubleshooting-runbook.md). Access to the homolog environment through its proxy is in [`docs/runbooks/bioadvanced-iap-access.md`](../runbooks/bioadvanced-iap-access.md); nothing of it is repeated here.

## 1. The stacks

Every stack is Docker Compose. The compose project name is the file's own `name:`.

| Compose file | Project | Purpose, from the file | How it is started | npm script (root `package.json`) |
|---|---|---|---|---|
| `compose.yml` | `bioavanced` | Base of the development stack: `mongodb`, `neo4j`, `influxdb`, `redis`, `tsa`, `witness`, each with a healthcheck and no published port. Never started alone. | Always with `compose.dev.yml` on top. | Through the `compose:*` scripts below. |
| `compose.dev.yml` | `bioavanced` | Development overlay: adds `backend`, `worker`, `neo4j-projection-worker`, `frontend` (built from `Dockerfile.dev`, source bind-mounted), the one-shot jobs `foundation-bootstrap`, `essential-reference-bootstrap` and the `reference-data-bootstrap*` importers, and publishes every port on `127.0.0.1`. | `--env-file .env.docker -f compose.yml -f compose.dev.yml` | `compose:config`, `compose:up`, `compose:ps`, `compose:logs`, `compose:seed-admin`, `compose:down` |
| `compose.prod.yml` | `bioavanced-prod` | Production stack, self-contained: `mongodb`, `neo4j`, `influxdb`, `redis`, `tsa`, `witness`, the one-shot jobs `foundation` and `essential-references`, `backend`, `worker`, `neo4j-projection-worker`, `frontend`, built from `Dockerfile.prod`, read-only containers with CPU and memory limits. | `--env-file .env.production -f compose.prod.yml` | `compose:prod:config`, `compose:prod:up`, `compose:prod:ps`, `compose:prod:logs`, `compose:prod:seed-admin`, `compose:prod:down` |
| `compose.test.yml` | `bioavanced-test` | The e2e stack: every service with a `-test` suffix, its own S3-compatible store (`s3-test`), SMTP (`smtp-test`) and MQTT (`mqtt-test`) services, an `admin-bootstrap-test` job, and the unit and Playwright runners. | `.github/workflows/ci-pipeline.yml` runs it with `--env-file .env.test.example -f compose.test.yml`. | None. |
| `compose.lab.yml` | (overlay) | "Opt-in overlay for REFERENCE_IMPORT_PROFILE=full-lab on a lab VM/host": mounts the host directories `REFERENCE_FULL_ASSET_DIR_HOST` and `REFERENCE_FULL_CACHE_DIR_HOST` into `backend`, `worker` and the `reference-data-bootstrap*` importers. Its own header says it "Does not change the default compose:up / e2e-gate fixture path." | On top of the development pair; the command is in the file's header comment. | None. |

`scripts/start-local-stack.ps1` and `scripts/stop-local-stack.ps1` default to `-ComposeFile docker-compose.yml`, a file the repo does not track, and the start script then runs `npm run seed`, a script the root `package.json` does not define. Neither is an install path at this commit; see [Gaps](#8-gaps).

## 2. Prerequisites

As `README.md` (Local Development) states them: Git, Docker Engine or Docker Desktop, and Docker Compose v2. Node.js, MongoDB, Neo4j, Redis and InfluxDB are not installed on the host for the Compose path.

The two env generators add their own: `bash`, `openssl` and Python 3 (`python3`, or `python` when it is Python 3). Both refuse to run without them (`generate-env-production-secrets.sh`, `generate-env-docker-secrets.sh`).

## 3. Installing the development stack

1. Create `.env.docker`. Either copy `.env.docker.example` to it, as `README.md` does, or generate it, which mints every database password, token and secret and the audit signing key:

   ```bash
   bash generate-env-docker-secrets.sh
   ```

   The script writes `.env.docker` (or the path given as its argument) and refuses to overwrite an existing one. `--upgrade` adds only the variables missing from an existing file and rewrites the three `AUDIT_MERKLE_SIGN_*` lines; it never regenerates a credential that has a value. It writes the Ed25519 audit signing key to `infra/audit/secrets/merkle_signing_key.pem`, reused when present, which `compose.dev.yml` mounts read-only at `/run/secrets` in `backend` and `worker`. Every variable it does not mint is copied from `.env.docker.example`, the `BOOTSTRAP_ADMIN_*` ones included; `AUTH_RATE_LIMIT_RELAXED` and `CONSENT_RATE_LIMIT_RELAXED` are written blank. It writes `NODE_ENV=development`.

2. Check and start:

   ```bash
   npm run compose:config
   npm run compose:up
   ```

   `compose:up` runs three `docker compose ... up -d --wait` in a row: first `mongodb neo4j redis influxdb tsa witness backend worker neo4j-projection-worker frontend`, then `foundation-bootstrap`, then `reference-data-bootstrap`. The order comes from `depends_on` in `compose.dev.yml`:
   - `foundation-bootstrap` (`npm run seed:essential`) waits for `mongodb` healthy; `essential-reference-bootstrap` (`npm run reference:load:essential`) waits for it to complete successfully;
   - `backend` waits for both jobs to complete successfully and for `mongodb`, `redis`, `neo4j`, `influxdb`, `tsa` and `witness` healthy;
   - `worker` and `neo4j-projection-worker` wait for `mongodb`, `redis`, `neo4j` and `influxdb` healthy;
   - `frontend` waits for `backend` healthy;
   - `reference-data-bootstrap` (`npm run reference:import:hpo`), started only by the third call, waits for `foundation-bootstrap`. The further importers (`reference-data-bootstrap-mondo`, `reference-data-bootstrap-orpha` and the rest, to `reference-data-bootstrap-edam`) each wait for the one before them, but nothing pulls them in from `reference-data-bootstrap`, and no npm script starts them.

   The development `backend` does not set `FOUNDATION_READINESS_REQUIRED`, so it does not check the ReadinessReport itself (section 4); the `depends_on` above is the only gate.

3. Create the first administrator (section 5):

   ```bash
   npm run compose:seed-admin
   ```

4. Stop:

   ```bash
   npm run compose:down
   ```

   `compose:down` runs `down --volumes --remove-orphans`: it deletes the stack's named volumes (`mongodb_data`, `neo4j_data`, `influxdb_data`, `redis_data`, `backend_node_modules`, `frontend_node_modules`), so every record in the development stack is gone.

## 4. Installing the production stack

### 4.1 The env file

`compose.prod.yml` reads `.env.production` twice: by `--env-file` interpolation for the database containers' credentials (`${NEO4J_PASSWORD:?...}` and the like, which stop `compose` when blank), and as `env_file` for `foundation`, `essential-references`, `backend`, `worker`, `neo4j-projection-worker` and `frontend`. Generate it:

```bash
bash generate-env-production-secrets.sh
```

What the script does (`generate-env-production-secrets.sh`):

- Refuses to overwrite an existing `.env.production` (or the path given as its argument), "so a re-run cannot mint new credentials over the volumes a running stack was initialised with".
- Mints `MONGO_ROOT_PASSWORD`, `NEO4J_PASSWORD`, `INFLUXDB_INIT_PASSWORD`, `REDIS_PASSWORD`, `INFLUXDB_TOKEN`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CONSENT_SECRET`, `ENCRYPTION_KEY` and `USER_ANON_SALT`; builds `MONGO_URI` from `MONGO_ROOT_USERNAME`, the minted password and `MONGO_DB`, so the two cannot disagree; sets `MONGO_DB_NOVO` to `MONGO_DB`.
- Mints the Ed25519 audit signing key to `infra/audit/prod/secrets/merkle_signing_key.pem` when absent, sets `AUDIT_MERKLE_SIGN_PRIVATE_KEY_FILE` to its in-container path and `AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON` to its public half under `AUDIT_MERKLE_SIGN_KEY_ID`. On Linux it sets the key 0400 in a 0700 directory and, as root, gives it to uid 10001, the `app` user of `api/backend/Dockerfile.prod`; run as another user, it prints the `chown` and `chmod` to run. On Windows it skips the modes and says so.
- Copies every other line of `.env.production.example` as it is, writes the file mode 600, and prints:
  - the keys it left blank, to fill by hand. From `.env.production.example` these are `RESEND_API_KEY`, `EMAIL_FROM`, `ALLOWED_ORIGINS`, `AUDIT_RFC3161_TSA_AUTH_TOKEN`, `AUDIT_EXTERNAL_WITNESS_PUBLIC_KEY`, `FRONTEND_URL`, `MQTT_URL`, `ALERT_EMAIL_TO` and `TELEMETRY_INGEST_SECRET`, plus `ENCRYPTION_KEY_PREVIOUS` and `ENCRYPTION_KEY_PREVIOUS_ID`, which it marks as the rotation slot, blank by design;
  - the commented `BACKUP_OFFSITE_S3_*` keys, off until all four of endpoint, bucket, access key id and secret are set ([backup-restore-runbook.md](backup-restore-runbook.md), section 2).

`api/backend/tests/architecture/env-production-generator.arch.test.js` pins this behaviour. What each variable does, and which are required, is in [configuration-runbook.md](configuration-runbook.md).

The `.env.production.example` footer lists what must not be added: `ENABLE_TEST_SUPPORT_ROUTES`, `TEST_SUPPORT_SECRET`, `BOOTSTRAP_ADMIN_*`, and `VITE_*`, which are build-time arguments of the frontend image, not runtime env.

### 4.2 Start

```bash
npm run compose:prod:config
npm run compose:prod:up
```

`compose:prod:up` is `docker compose --env-file .env.production -f compose.prod.yml up -d --wait`: it builds the four images from the repo when they are absent (`api/backend/Dockerfile.prod` for `foundation`, `essential-references`, `backend`, `worker` and `neo4j-projection-worker`; `frontend/Dockerfile.prod`; `infra/tsa/Dockerfile`; `infra/witness/Dockerfile`) and starts the stack in the order `depends_on` gives:

1. `mongodb`, `neo4j`, `influxdb`, `redis`, `tsa`, `witness` start and must turn healthy (section 6).
2. `foundation` starts when `mongodb` is healthy. It runs `node scripts/seed-essential-reference-data.js` (the image's form of `npm run seed:essential`): the Foundation Data Pipeline's dry-run, apply and verify. It writes a ReadinessReport and exits non-zero when that report is blocked.
3. `essential-references` starts when `foundation` completed successfully. It runs `node scripts/load-essential-references.js` (`npm run reference:load:essential`), the essential reference set, and exits 1 without a ready ReadinessReport.
4. `worker` and `neo4j-projection-worker` start when `foundation` completed successfully and `mongodb`, `redis`, `neo4j` and `influxdb` are healthy.
5. `backend` starts when `foundation` and `essential-references` completed successfully and all six services of step 1 are healthy.
6. `frontend` starts when `backend` is healthy.

A `foundation` that exits non-zero stops steps 3 to 6: `service_completed_successfully` is not met.

### 4.3 The readiness gate

`compose.prod.yml` sets `FOUNDATION_READINESS_REQUIRED: "true"` on `backend` (as `compose.test.yml` does on `backend-app-test`). With it set, `startServer` in `api/backend/server.js` calls `assertReadiness` (`api/backend/src/foundation/readiness.js`) right after connecting to MongoDB. `assertReadiness` reads the newest ReadinessReport for the environment `NODE_ENV` (collection `COLL_READINESS_REPORTS`, default `readinessReports`) and throws `FoundationNotReadyError` when:

- there is no report for the environment;
- its `status` is not `ready` (the message lists its `blockers`);
- its `canonicalModelReleaseId` is not this build's `CANONICAL_MODEL_RELEASE_ID` (`release-<DICTIONARY_VERSION>`).

The throw reaches `startServer`'s catch, which exits 1; `restart: unless-stopped` starts it again. With the flag set, the backend also leaves the RBAC catalog and report templates to the Foundation job instead of seeding them at start (`server.js`).

Before the readiness check, `startServer` exits 1 when `MONGO_URI`, `JWT_SECRET`, `USER_ANON_SALT` or `CONSENT_SECRET` is missing, and `validateEncryptionAndHalt` (`api/backend/src/config/validateEnv.js`) stops a `production` start with a blank `ENCRYPTION_KEY` or with `ALLOW_UNENCRYPTED_FILE_STORAGE` or `ALLOW_UNENCRYPTED_FIELD_STORAGE` set to `true`.

### 4.4 Stop

```bash
npm run compose:prod:down
```

`compose:prod:down` runs `down --remove-orphans`, without `--volumes`: the named volumes (data, backups, TSA and witness keys) stay.

## 5. The first administrator

A new stack has no user. `api/backend/src/scripts/createFirstAdmin.js` (`npm run admin:create-first` in `api/backend`) creates one:

- It reads `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_TEMP_PASSWORD` from its environment and throws when any is blank.
- It does nothing when the `users` collection already holds a document (`skipped`, `users_exist`), so a re-run is harmless.
- It checks the password against the deployment's password policy (`validateStrength`, `resolvePasswordPolicy`), seeds the RBAC catalog, creates the user and grants it the administrator role.
- The user must change the password at first login unless `BOOTSTRAP_ADMIN_FORCE_RESET` is `false`; unset, the reset is forced.

Development: `.env.docker.example` carries the four `BOOTSTRAP_ADMIN_*` variables, so

```bash
npm run compose:seed-admin
```

runs the script inside `backend`. The values in `.env.docker.example` are shared test values: change them in `.env.docker` for any stack reachable by someone else.

Production:

```bash
npm run compose:prod:seed-admin
```

runs the same script inside the production `backend`, whose environment is `.env.production`. `.env.production.example` deliberately carries no `BOOTSTRAP_ADMIN_*` ("The first administrator is created by a deliberate, hand-run script"), so the script refuses until the four are in that container's environment; see [Gaps](#8-gaps).

## 6. Checking the install

```bash
npm run compose:ps
npm run compose:prod:ps
```

Each service is `healthy` when its healthcheck passes. The checks the compose files declare:

| Service | Check | Files |
|---|---|---|
| `mongodb` | `mongosh` authenticated with `MONGO_ROOT_USERNAME` and `MONGO_ROOT_PASSWORD`, `db.adminCommand('ping')` | `compose.yml`, `compose.prod.yml` |
| `neo4j` | `cypher-shell` with `NEO4J_USERNAME` and `NEO4J_PASSWORD`, `RETURN 1` | `compose.yml`, `compose.prod.yml` |
| `influxdb` | `influx ping` on `http://localhost:8086` | `compose.yml`, `compose.prod.yml` |
| `redis` | `redis-cli ping`; in production authenticated through `REDISCLI_AUTH` from `REDIS_PASSWORD` | `compose.yml`, `compose.prod.yml` |
| `tsa`, `witness` | HTTP `GET /health` on 8095 and 8096 | `compose.yml`, `compose.prod.yml` |
| `backend` | HTTP `GET /api/health` on 3000 | `compose.dev.yml`, `compose.prod.yml` |
| `worker` | `/tmp/worker-heartbeat` touched in the last 60 s | `compose.dev.yml`, `compose.prod.yml` |
| `neo4j-projection-worker` | `/tmp/neo4j-projection-heartbeat` touched in the last 60 s | `compose.dev.yml`, `compose.prod.yml` |
| `frontend` | `wget` of `http://127.0.0.1/` | `compose.prod.yml` only; the development `frontend` has none |

The one-shot jobs have no healthcheck; `ps` shows their exit code. Their output, and every service's, is in

```bash
npm run compose:logs
npm run compose:prod:logs
```

Ports:

- **Development** (`compose.dev.yml`): every published port binds `127.0.0.1` only (`docs/decisions/2026-10-23-compose-ports-loopback.md`): `MONGO_HOST_PORT` (27017), `NEO4J_HTTP_HOST_PORT` (7474), `NEO4J_BOLT_HOST_PORT` (7687), `INFLUXDB_HOST_PORT` (8086), `REDIS_HOST_PORT` (6379), `TSA_HOST_PORT` (8095), `WITNESS_HOST_PORT` (8096), `BACKEND_HOST_PORT` (3000), `BACKEND_DEBUG_HOST_PORT` (9229, the Node inspector), `FRONTEND_HOST_PORT` (5173). The defaults are the compose files' own; a value in `.env.docker` moves the port. `compose.test.yml` binds `127.0.0.1` too.
- **Production** (`compose.prod.yml`): only `backend` (`BACKEND_HOST_PORT`, default 3000) and `frontend` (`FRONTEND_HOST_PORT`, default 80) are published, and on every host interface, not loopback: the decision above leaves production exposure "a deployment decision". The databases, `tsa` and `witness` publish nothing and are reached by service name on the compose network. `frontend/nginx.conf` listens on 80 and configures no TLS. `.env.production.example` (`TRUST_PROXY`) says to stop publishing the backend's port once a reverse proxy sets `X-Forwarded-For`.

## 7. Volumes that hold state

`compose.prod.yml` keeps `mongodb_data`, `neo4j_data`, `influxdb_data`, `redis_data`, `uploads_data`, `storage_data`, `backups_data`, `tsa_certs`, `tsa_state`, `tsa_secrets` and `witness_secrets`. Its comments record that the TSA and witness volumes hold key material and the TSA serial, and that losing them invalidates previously issued timestamps and signatures. A stack whose `tsa_*` and `witness_secrets` volumes predate the non-root images needs the one-off `chown` the file's `tsa` comment gives. What is and is not backed up is in [backup-restore-runbook.md](backup-restore-runbook.md).

## 8. Gaps

| Criterion | What the code does today | Gap |
|---|---|---|
| RNF006 C2, installation: host scripts | `scripts/start-local-stack.ps1` and `scripts/stop-local-stack.ps1` exist. | Not implemented: both default to `docker-compose.yml`, which the repo does not track, and the start script calls `npm run seed`, which the root `package.json` does not define; neither runs as written. |
| RNF006 C2, installation: production first administrator | `npm run compose:prod:seed-admin` runs `createFirstAdmin.js` inside the production `backend`, which reads `BOOTSTRAP_ADMIN_*` from its environment. | Not implemented: `.env.production.example` excludes `BOOTSTRAP_ADMIN_*` and the repo defines no other way to hand the four variables to the production container, so no tracked script creates the production administrator end to end. |
| RNF006 C2, installation: readiness gate on the workers | `compose.prod.yml` starts `worker` and `neo4j-projection-worker` only after `foundation` completed successfully. | Not implemented: neither worker calls `assertReadiness`; only `api/backend/server.js` does, so a worker restarted later is not stopped by a blocked or missing ReadinessReport. The development `backend` does not set `FOUNDATION_READINESS_REQUIRED` and is not gated either. |
| RNF006 C2, installation: network exposure | `compose.prod.yml` publishes `backend` and `frontend` on every host interface; `frontend/nginx.conf` listens on plain HTTP. | Not implemented: no TLS termination, reverse proxy or firewall rule is part of the production stack; the homolog proxy is outside it ([`docs/runbooks/bioadvanced-iap-access.md`](../runbooks/bioadvanced-iap-access.md)). |
| RNF006 C2, installation: test and lab stacks | `compose.test.yml` is started by `.github/workflows/ci-pipeline.yml`; `compose.lab.yml` by the command in its header comment. | Not implemented: no npm script starts either stack. |
| RNF006 C2, installation: host requirements | `compose.prod.yml` sets CPU and memory limits per service, recorded there as "a starting point to revisit against measured use". | Not implemented: no documented host size, disk size or supported operating system. |
