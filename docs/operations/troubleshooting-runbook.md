# Troubleshooting runbook

Answers RNF006 C2 ("Documentar instalação, configuração, backup, restauração, APIs, eventos, outbox e troubleshooting.") for troubleshooting. Written 2026-11-13. It describes what the code does at this commit, nothing more; every symptom below is one the code produces, quoted from its source line, and everything a troubleshooting guide would need that the code does not give is listed under [Gaps](#7-gaps), never as a procedure. Tracking issue: #1472.

Sources: `compose.prod.yml`, `compose.yml`, `api/backend/server.js`, `api/backend/app.js`, `api/backend/src/foundation/readiness.js`, `api/backend/src/config/env.js`, `api/backend/src/config/validateEnv.js`, `api/backend/src/infrastructure/health/dependencyHealth.js`, `api/backend/src/interface/routes/monitoring.routes.js`, `api/backend/src/services/platformAlert.service.js`, `api/backend/src/infrastructure/metrics/platformAlerts.js`, `api/backend/src/infrastructure/metrics/queueDepth.js`, `api/backend/src/services/scheduler.service.js`, `api/backend/src/services/alertLifecycle.service.js`, `api/backend/src/scripts/clearMfaLockForUser.js`, `api/backend/package.json`, `api/backend/src/services/auth.service.js`, `api/backend/src/controllers/auth.controller.js`, `api/backend/src/interface/routes/user.routes.js`, `api/backend/src/services/securityAlerts.service.js`, `api/backend/src/interface/routes/compliance.routes.js`, `api/backend/src/workers/neo4jProjection.worker.js`, [backup-restore-runbook.md](backup-restore-runbook.md), [outbox-runbook.md](outbox-runbook.md).

Each entry gives the symptom, where it shows (a log line or error text quoted from the source, an alert code, an HTTP status), the cause as the code decides it, and what to run or check. Log lines are in Portuguese, as the code writes them. The commands read the production stack's logs and state:

```sh
docker compose -f compose.prod.yml ps
docker compose -f compose.prod.yml logs backend
docker compose -f compose.prod.yml logs worker
docker compose -f compose.prod.yml logs neo4j-projection-worker
docker compose -f compose.prod.yml logs foundation
```

## 1. Start-up

The `backend` service runs `startServer` in `api/backend/server.js`. A refusal logs, then exits 1; `restart: unless-stopped` restarts the container, so a refusal shows as a container that keeps restarting and never turns `healthy`.

`api/backend/src/config/env.js` throws nothing: it reads each variable with its default, and a flag such as `FOUNDATION_READINESS_REQUIRED` or `NEO4J_REQUIRED` is on only for `true` or `1`. The refusals are the ones below.

### 1.1 A critical variable is missing

- **Shows**: `Variáveis críticas ausentes: MONGO_URI, JWT_SECRET, USER_ANON_SALT e CONSENT_SECRET são obrigatórias.`, then exit 1 (`server.js`).
- **Cause**: one of `MONGO_URI`, `JWT_SECRET`, `USER_ANON_SALT` is empty, or `CONSENT_SECRET` is blank.
- **Check**: the four variables in the env file the service reads (`.env.production` for `compose.prod.yml`). The message names all four whichever is missing.

### 1.2 Encryption posture refused in production

- **Shows**: `Configuração de criptografia inaceitável em produção (#1085): ...`, preceded by one error line per cause, such as `[SECURITY] ENCRYPTION_KEY não está definida: ...` or `[SECURITY] ALLOW_UNENCRYPTED_FILE_STORAGE=true: ...`; then `Erro fatal ao iniciar servidor:` and exit 1 (`validateEncryptionAndHalt` in `validateEnv.js`).
- **Cause**: with `NODE_ENV` `production`, `ENCRYPTION_KEY` is blank, or `ALLOW_UNENCRYPTED_FILE_STORAGE` or `ALLOW_UNENCRYPTED_FIELD_STORAGE` is `true`. In any other environment the same findings are warnings and the server starts.
- **Check**: set `ENCRYPTION_KEY`; remove the two opt-outs.

### 1.3 Audit signing warnings (not fatal)

- **Shows**: a warning starting `[AUDIT] AUDIT_MERKLE_SIGN_KEY_ID não está configurado`, `[AUDIT] a chave privada de assinatura não pôde ser lida`, `[AUDIT] a chave de assinatura "<id>" assina mas não verifica` or `[AUDIT] o teste de assinatura no boot falhou` (`validateAuditSigningAndWarn` in `validateEnv.js`). The server starts anyway, in every environment.
- **Cause**: the signing key id, the private key, or the public keys do not form a working pair; the boot signs and verifies a probe to find out.
- **Check**: `AUDIT_MERKLE_SIGN_KEY_ID`, the key mounted from `infra/audit/prod/secrets` (`compose.prod.yml`), and `AUDIT_MERKLE_SIGN_PUBLIC_KEYS_FILE` or `AUDIT_MERKLE_SIGN_PUBLIC_KEYS_JSON`, as the warning itself says. Until fixed, the daily seal of audit roots fails.

### 1.4 Foundation readiness refused

- **Shows**: `Erro fatal ao iniciar servidor:` with a `FoundationNotReadyError` (`assertReadiness` in `api/backend/src/foundation/readiness.js`), one of:
  - `Nenhum ReadinessReport para o ambiente <env>: execute o Foundation Data Pipeline antes da API.`
  - `ReadinessReport <id> está <status>: <blockers>`
  - `ReadinessReport <id> é da release <release>, esta build espera <release>.`
- **Cause**: `FOUNDATION_READINESS_REQUIRED` is on (`compose.prod.yml` sets it to `true` for `backend`), and the newest ReadinessReport for `NODE_ENV` is missing, not `ready`, or names another canonical model release than `CANONICAL_MODEL_RELEASE_ID`.
- **Check**: the `foundation` service, which `backend` waits for (`service_completed_successfully`): its logs (above) and exit status in `ps`. For the third message, the build and the Foundation run are of different releases.

### 1.5 Neo4j unreachable at start

- **Shows**: `[ISO20387][NEO4J] Falha ao iniciar validação topológica: <error>` (`server.js`). Then either `Erro fatal ao iniciar servidor:` and exit 1, or `[ISO20387][NEO4J] Modo permissivo habilitado (dev/test): operações seguirão sem bloqueio global` and the server goes on without a Neo4j driver.
- **Cause**: `connectNeo4j` failed. It is fatal when `LINEAGE_MODE` is `fail-closed` or `NEO4J_REQUIRED` is on; otherwise (`LINEAGE_MODE` defaults to `fail-open`) it is not.
- **Check**: the `neo4j` service's health (section 2.1) and `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`.

### 1.6 Redis unavailable (not fatal for the API)

- **Shows**: `⚠️ Redis indisponível` or `Erro ao iniciar Redis: <error>` (`server.js`); the server still listens. In `/api/health`, `checks.redis` is `down` and `degraded` is `true` (section 2.2).
- **Cause**: the queue could not connect. The API's synchronous routes do not need Redis; import enqueueing degrades.
- **Check**: the `redis` service's health and `REDIS_PASSWORD`, `REDIS_URL` or `REDIS_HOST`.

### 1.7 Other start-up lines

| Shows | Source | Meaning |
|---|---|---|
| `Erro ao iniciar scheduler: <error>` | `server.js` | the API serves, but no scheduled task of section 4 runs |
| `[ISO20387][QUARANTINE] Falha ao iniciar worker de quarentena: ...`, `[ISO20387][TELEMETRY] Falha ao iniciar monitor: ...`, `[ISO20387][MQTT] Falha ao iniciar ingestão MQTT: ...` | `server.js` | that component is off; the API serves |
| `#1254: falha ao reconciliar session.allowMultipleSessions: ...` | `server.js` | not fatal; retried on the next boot |
| `[#1040] unhandledRejection não tratada -- encerrando servidor:` or `[#1040] uncaughtException -- encerrando servidor:` | `server.js` | an error no code handled; the process exits 1 |
| `🔌 Porta escolhida: <port>` | `server.js` | the port the server took; the `backend` healthcheck probes port 3000 |

## 2. Database stores

### 2.1 A store never turns healthy

- **Shows**: `docker compose -f compose.prod.yml ps` lists the store as `unhealthy` or `starting`, and every service that `depends_on` it with `condition: service_healthy` does not start.
- **Cause**: its healthcheck in `compose.prod.yml` keeps failing:

| Service | Healthcheck | Retries, start period |
|---|---|---|
| `mongodb` | `mongosh` with `MONGO_ROOT_USERNAME` and `MONGO_ROOT_PASSWORD`, `db.adminCommand('ping')` | 10, 10 s |
| `neo4j` | `cypher-shell` with `NEO4J_USERNAME` and `NEO4J_PASSWORD`, `RETURN 1` | 15, 20 s |
| `influxdb` | `influx ping` on port 8086 | 15, 20 s |
| `redis` | `redis-cli ping`, authenticated through `REDISCLI_AUTH` | 10, 5 s |
| `tsa`, `witness` | `GET /health` on ports 8095 and 8096 | 20, 10 s |

`compose.yml` defines the same six services with the same probe commands.
- **Check**: the store's own logs (`docker compose -f compose.prod.yml logs mongodb`, and so on), and that the credentials the healthcheck uses are the ones the store was initialised with.

### 2.2 A required compose variable is empty

- **Shows**: `docker compose -f compose.prod.yml` refuses to start with an error ending in `MONGO_ROOT_USERNAME is required`, `MONGO_ROOT_PASSWORD is required`, `NEO4J_USERNAME is required`, `NEO4J_PASSWORD is required` or `REDIS_PASSWORD e obrigatorio`.
- **Cause**: `compose.prod.yml` interpolates these with `${...:?...}`, which fails when the variable is unset or empty.
- **Check**: the variable in the environment or env file compose reads.

### 2.3 `/api/health` answers 503, or `degraded: true`

`GET /api/health` (`app.js`, unauthenticated) runs `checkDependencies` (`dependencyHealth.js`): MongoDB, Neo4j, Redis and InfluxDB in parallel, each within 800 ms (`PROBE_TIMEOUT_MS`).

- **Shows**: HTTP 503 with `status: "UNAVAILABLE"` when a critical check is `down`; HTTP 200 with `degraded: true` when only a non-critical one is. Each check in `checks` has `status` (`up`, `down` or `not_configured`), `critical`, `latencyMs` and, when down, `reason`: `timeout`, `unreachable`, `not_connected` or `incomplete_configuration`.
- **Cause**: MongoDB is always critical. Neo4j is critical only when `LINEAGE_MODE` is `fail-closed` or `NEO4J_REQUIRED` is on, and `not_configured` without `NEO4J_URI`. Redis and InfluxDB are never critical. InfluxDB with a URL but missing settings is `incomplete_configuration`.
- **Check**: the `backend` healthcheck fails on any non-2xx answer (`compose.prod.yml`, 20 retries every 15 s, 30 s start period), so a 503 turns the container `unhealthy` and holds back `frontend`. Fix the store the `checks` entry names.

### 2.4 InfluxDB unreachable for the temperature monitor

- **Shows**: `Erro no monitoramento de temperatura: <error>` (`scheduler.service.js`) and, per sensor, an active alert of type `telemetry_store_unavailable` (`ALERT_TYPES.TELEMETRY_STORE_UNAVAILABLE`, `alertLifecycle.service.js`) in the `alerts` collection with the message `Armazenamento de telemetria indisponível; leituras do sensor não verificadas`, severity `critical`.
- **Cause**: `lastReadingAtBySensor` failed; no stale or missing reading alert is written or resolved that run. The next successful run resolves these alerts.
- **Check**: the `influxdb` service and `INFLUXDB_URL`, `INFLUXDB_TOKEN`, `INFLUXDB_ORG`, `INFLUXDB_BUCKET`.

### 2.5 Backup and restore-test failures

The messages of a failed backup and of a failed restore test are in [backup-restore-runbook.md](backup-restore-runbook.md), sections 6 and 9; they are not repeated here.

## 3. Workers and the outbox

### 3.1 `worker` or `neo4j-projection-worker` unhealthy

- **Shows**: `ps` lists the service as `unhealthy`.
- **Cause**: its healthcheck (`compose.prod.yml`) fails when the heartbeat file is older than 60 s: `/tmp/worker-heartbeat` for `worker`, `/tmp/neo4j-projection-heartbeat` for `neo4j-projection-worker` (written after each pass of `runProjectionWorker`). The loop has stopped or a pass is hanging.
- **Check**: the service's logs. For the projection worker, `[GRAPH_OUTBOX] Worker falhou: <error>` means the process exited (MongoDB or Neo4j unreachable is the usual cause) and is restarted by `restart: unless-stopped`. The rest is in [outbox-runbook.md](outbox-runbook.md), section 5.

### 3.2 `OUTBOX_DEAD_LETTER` firing

- **Shows**: alert `OUTBOX_DEAD_LETTER`, subject `graph_projection_outbox`, in `GET /api/monitoring/alerts`; worker log `[GRAPH_OUTBOX] DEAD_LETTER: evento parou após o limite de tentativas` or `[GRAPH_OUTBOX] DEAD_LETTER: lease expirado na última tentativa`.
- **Cause**: an event failed `GRAPH_OUTBOX_MAX_ATTEMPTS` times; it holds every later version of its aggregate.
- **Check**: [outbox-runbook.md](outbox-runbook.md), sections 5 and 6.1.

### 3.3 Queue alerts

`QUEUE_UNAVAILABLE`, `QUEUE_BACKLOG` and `QUEUE_FAILED` concern the BullMQ queues `import-queue` and `notification-queue` (`queueDepth.js`); section 4.1 says what fires each. `GET /api/monitoring/metrics` shows each queue's `status` and counts. A queue the API process never created reads `not_initialized`, and its three alerts stay `unknown`.

## 4. Scheduler and alerts

`initScheduler` (`scheduler.service.js`) runs in the `backend` process only (called from `server.js`). Each task logs its expression when scheduled, for example `⏱️ Verificação de alertas da plataforma agendada (*/5 * * * *)`; the time zone is `TZ`, default `America/Sao_Paulo`.

| Task | Variable, default | Failure log |
|---|---|---|
| temperature monitor | `TEMP_MONITOR_CRON`, `*/10 * * * *` | `Erro no monitoramento de temperatura:` |
| backup | `BACKUP_CRON`, `0 3 * * *`, replaced by the stored policy's `cronExpression` | `Erro ao executar backup agendado:`; `Expressão cron inválida na política de backup, mantendo agendamento anterior:`; `Erro ao recarregar política de backup, mantendo agendamento anterior:` |
| retention sweep | `RETENTION_SWEEP_CRON`, `0 4 * * *` | `Erro no sweep de retenção:` |
| restore test | `RESTORE_TEST_CRON`, `0 5 * * 0` | `Nenhum backup disponível para o teste de restauração periódico` (warning); `Teste de restauração periódico falhou: <path>`; `Erro no teste de restauração periódico:` |
| platform alert check | `PLATFORM_ALERT_CRON`, `*/5 * * * *` | `Erro na verificação de alertas da plataforma:` |

### 4.1 Platform alert codes

`runPlatformAlertCheck` (`platformAlert.service.js`) evaluates the rules of `platformAlerts.js` on each run. A rule is `firing`, `ok` or `unknown`. A `firing` rule with no open episode opens one in `platformAlerts`, logs `[PLATFORM_ALERT] <code> <subject> valor=<value> limite=<threshold>` as an error and dispatches a `platform_alert` notification; `ok` resolves it (`[PLATFORM_ALERT] <code> <subject> resolvido`); `unknown` changes nothing. Each run logs `🚨 Verificação de alertas da plataforma executada: regras=<n> disparadas=<n>`.

| Code | Subject | Severity | Fires when | Threshold |
|---|---|---|---|---|
| `HTTP_ERROR_RATE` | `http` | critical | errors / requests since the previous run is above the threshold; `unknown` under 20 requests (`MIN_REQUESTS`) | `ALERT_HTTP_ERROR_RATE`, default 0.05 |
| `HTTP_LATENCY_P95` | `http` | warning | the p95 latency bucket since the previous run is above the threshold; `unknown` under 20 requests | `ALERT_HTTP_P95_MS`, default 2500 |
| `QUEUE_UNAVAILABLE` | the queue name | critical | the queue's status is not `up` (and it exists) | none |
| `QUEUE_BACKLOG` | the queue name | warning | `waiting` + `delayed` jobs above the threshold | `ALERT_QUEUE_BACKLOG`, default 100 |
| `QUEUE_FAILED` | the queue name | warning | the `failed` count rose since the previous run | 0 |
| `OUTBOX_DEAD_LETTER` | `graph_projection_outbox` | critical | any outbox row is `DEAD_LETTER` (section 3.2) | 0 |
| `BACKUP_RPO` | `backup` | critical | the newest successful backup is older than the policy's `rpoHours`, or runs exist and none succeeded ([backup-restore-runbook.md](backup-restore-runbook.md), section 7) | `rpoHours` |

Other lines from the check:

| Shows | Cause | Check |
|---|---|---|
| `[PLATFORM_ALERT] ALERT_HTTP_ERROR_RATE inválido, usando o padrão 0.05` (and the same for the other two) | the variable is not a number in range (rate in (0, 1], p95 above 0, backlog 0 or more) | the variable's value; the default is in force |
| `[PLATFORM_ALERT] verificação anterior ainda em andamento, execução ignorada` | a run started while the previous one was pending | a slow MongoDB; the cron task is also `noOverlap` |
| `[PLATFORM_ALERT] contagem de DEAD_LETTER indisponível`, `[PLATFORM_ALERT] leitura do RPO de backup indisponível` | the read failed or passed 2 s; that rule is `unknown` | MongoDB |
| `[PLATFORM_ALERT] falha ao gravar o episódio <key>:` | the `platformAlerts` write failed | MongoDB |
| `[NOTIFICATION_DISPATCH] Falha ao disparar notificação de alerta da plataforma:` | the notification failed; the episode is recorded anyway | the notification rules for `platform_alert` |

### 4.2 Reading the monitoring routes

`monitoring.routes.js`, mounted at `/api/monitoring` (`app.js`), every route authenticated and `requireRole(4)` (Administrador):

| Route | Gives | Errors |
|---|---|---|
| `GET /api/monitoring/runs?limit=` | the recent Foundation, configuration, reference and import runs | 400 `limit deve ser um inteiro de 1 a 100`; 500 `Erro ao ler as execuções` |
| `GET /api/monitoring/metrics` | `http` (request count, latency, errors per route template) and `queues` | 500 `Erro ao ler as métricas` |
| `GET /api/monitoring/alerts` | `evaluatedAt` and `results` of the last check in this process, and up to 100 active episodes | 500 `Erro ao ler os alertas` |

`evaluatedAt` and `results` are `null` until the first check after a start.

### 4.3 Sensor reading alerts

- **Shows**: an active alert in `alerts` of type `missing_reading`, message `Nenhuma leitura registrada para o sensor` (critical), or `stale_reading`, message `Última leitura há mais de <n> minutos` (warning) (`checkStaleTemperatureReadings`, `scheduler.service.js`).
- **Cause**: InfluxDB holds no reading for the sensor, or its last one is older than `TEMP_STALE_MINUTES` (default 20). A fresh reading resolves both.
- **Check**: the sensor and its ingestion; section 2.4 when InfluxDB itself is down.

## 5. Authentication

### 5.1 MFA locked

- **Shows**: `POST` login answers 401 with `code: 'MFA_LOCKED'` and `MFA bloqueado devido a muitas tentativas falhas` (`auth.controller.js`, `auth.service.js`).
- **Cause**: five wrong MFA codes set `mfaLocked` on the user; the lock does not expire on its own. The lockout also dispatches an `mfa_brute_force_lockout` notification.
- **Check**: an Administrador (permission `resetMFA`) unlocks the user with `POST /api/users/:id/reset-mfa` (`user.routes.js`). When no Administrador can sign in, the break-glass script, run by an operator with database access (`api/backend/src/scripts/clearMfaLockForUser.js`); it takes a user id (`ObjectId`, `id` or `userID`), never an e-mail:

```sh
npm run mfa:clear-lock -- <id|_id|userID>
docker compose -f compose.prod.yml exec backend node src/scripts/clearMfaLockForUser.js <id|_id|userID>
```

It sets `mfaLocked: false` and `mfaFailedAttempts: 0` and nothing else, and prints the unlocked user to its standard output, which is the only record of the action (it writes no audit log). Its errors: `Identificador do usuário não informado. ...`, `MONGODB_URI ou MONGO_URI não encontrada nas variáveis de ambiente. ...`, `Nenhum usuário encontrado para o identificador '<id>'. Nenhuma alteração feita.`

### 5.2 Any other login failure

- **Shows**: 401 with `Erro ao fazer login. Verifique suas credenciais.` and the service's error in `message`; the backend logs `Erro no login:` with the stack (`auth.controller.js`).
- **Check**: the logged error.

### 5.3 Security alerts

- **Shows**: `[ALERTS] Alerta de segurança registrado - Tipo: <type>, Severidade: <severity>` (`securityAlerts.service.js`), one row in `security_alerts` with `status: 'open'`. The types the service raises are `CONSENT_BLOCKED`, `REVOKED_ACCESS`, `SUSPICIOUS_ACTIVITY`, `PII_EXPOSURE` and `SECURITY_BYPASS_ATTEMPT`.
- **Delivery**: for `high` and `critical` alerts, an e-mail to `ALERT_EMAIL_TO` when it is set (`[ALERTS] Email de alerta enviado`, or `[ALERTS] Erro ao enviar email:`); unset, no e-mail is sent.
- **Read and close**: `GET /api/compliance/alerts`, `POST /api/compliance/alerts/:id/acknowledge`, `POST /api/compliance/alerts/:id/resolve` (`compliance.routes.js`, role 4); 503 `Banco de dados não disponível` when the API has no database.
- **`[ALERTS] Database não inicializado`**: the service was called before `init`; that alert was not recorded.

## 6. Related documents

[outbox-runbook.md](outbox-runbook.md), [backup-restore-runbook.md](backup-restore-runbook.md), [install-runbook.md](install-runbook.md), [configuration-runbook.md](configuration-runbook.md), [../security/incident-and-continuity.md](../security/incident-and-continuity.md).

## 7. Gaps

| Criterion | What the code does today | Gap |
|---|---|---|
| RNF006 C2, configuration errors | `server.js` and `validateEnv.js` refuse four missing secrets and an unencrypted production posture (section 1); `env.js` validates nothing. | Not implemented: no check of other variables at start-up: a malformed number, cron expression or URI is found only when the code that reads it runs. |
| RNF006 C2, platform alerts reach someone | Episodes in `platformAlerts`, error logs, and a `platform_alert` notification where a rule for it exists (section 4.1). | Not implemented: no default notification rule for `platform_alert`; with none, an alert is visible only in the logs and `GET /api/monitoring/alerts`. |
| RNF006 C2, scheduler health | The tasks run inside the `backend` process and log each failure (section 4). | Not implemented: no record of each task's last run or result, and no alert for a task that stopped or failed, except `BACKUP_RPO`. |
| RNF006 C2, worker health | A heartbeat healthcheck per worker (section 3.1). | Not implemented: no alert or route for a worker that is down; Docker marks it `unhealthy` and nothing else reacts. |
| RNF006 C2, MFA break-glass record | `clearMfaLockForUser.js` prints the unlocked user to its standard output (section 5.1). | Not implemented: no audit-trail entry for the break-glass unlock. |
| RNF006 C2, log access | Logs go to each container's output (`docker compose ... logs`). | Not implemented: no central log store or search in the stack. |
