# Incident management and continuity

Answers the incident-management and continuity part of RNF013 C2 ("Há controles de acesso, gestão de incidentes, continuidade, backup, registro e revisão periódica."). Written 2026-11-13. It describes what the code does at this commit, nothing more; everything RNF013 C2 asks for here that the code does not do is listed under [Gaps](#6-gaps), never as a procedure. Tracking issue: #1472.

The system does not claim ISO/IEC 27001 certification (RNF013 C4); this document describes code, not a certified process. Backup, restore, RPO and RTO are in [backup-restore-runbook.md](../operations/backup-restore-runbook.md), and the risks, their owners and the review cadence in [risk-register.md](risk-register.md); neither is restated here.

Sources: `api/backend/src/services/securityAlerts.service.js`, `api/backend/src/infrastructure/middleware/integrationSecurityMiddleware.js`, `api/backend/src/services/log.service.js`, `api/backend/src/utils/auditLogger.js`, `api/backend/src/interface/routes/compliance.routes.js`, `api/backend/src/services/platformAlert.service.js`, `api/backend/src/infrastructure/metrics/platformAlerts.js`, `api/backend/src/services/scheduler.service.js`, `api/backend/src/interface/routes/monitoring.routes.js`, `api/backend/src/interface/routes/incident.routes.js`, `api/backend/src/controllers/incident.controller.js`, `api/backend/src/controllers/iot.controller.js`, `api/backend/src/models/TemperatureIncident.js`, `api/backend/src/services/sendIncidentAlertEmail.js`, `api/backend/src/services/NotificationService.js`, `api/backend/src/services/rbac-catalog-seed.service.js`, `api/backend/src/interface/routes/audit.routes.js`, `api/backend/src/interface/routes/user.routes.js`, `api/backend/scripts/audit-verify.js`, `api/backend/scripts/audit-verify-chain.js`, `api/backend/scripts/audit-verify-witnesses.js`, `api/backend/src/scripts/clearMfaLockForUser.js`, `api/backend/package.json`, `package.json`, `compose.prod.yml`, `.env.production.example`, `api/backend/app.js`.

Roles are the RBAC seed's (`rbac-catalog-seed.service.js`): Tecnico, Coordenador, Administrador. Routes are the mounts in `api/backend/app.js`.

## 1. What counts as an incident

The code raises three kinds of record. None of them is a security-incident record in the sense of a case with a classification, a timeline and a closure review (section 6).

### 1.1 Security alerts (`security_alerts` collection)

`logSecurityAlert` (`securityAlerts.service.js`) writes one row per alert: `type`, `severity` (`low`, `medium`, `high`, `critical`), `reason`, `details` (passed through `sanitizeSensitiveData`), `sourceIP`, `userAgent`, `affectedResources`, `status` (`open`, then `acknowledged`, then `resolved`). The types the code raises:

| Type | Severity | Raised by |
|---|---|---|
| `CONSENT_BLOCKED` | high | `consentBlockAlertWrapper` (`integrationSecurityMiddleware.js`), on a 403 whose code contains `CONSENT`, on the routes `applySecurityToAllCriticalRoutes` wraps; wired at startup by `initializeSecuritySystem` in `api/backend/server.js`. |
| `SUSPICIOUS_ACTIVITY` | critical | The same wrapper, when one user is refused for one participant 3 or more times in 5 minutes (`detectSuspiciousActivity`). |
| `AUDIT_TRAIL_WRITE_FAILURE` | critical | `auditLogger.js` when the primary audit row is not written (`details.failureKind` is `validation` or `infrastructure`), and `log.service.js` when a log row is not mirrored into `audit_events`, the Merkle trail (RNF009). |

`securityAlerts.service.js` also defines `alertConsentRevoked` (`REVOKED_ACCESS`), `alertPIIExposure` (`PII_EXPOSURE`) and `alertBypassAttempt` (`SECURITY_BYPASS_ATTEMPT`); no code calls them (section 6).

Where they surface: `GET /api/compliance/alerts` (`compliance.routes.js`, Administrador only), which lists the open alerts, highest severity first.

### 1.2 Platform alerts (`platformAlerts` collection)

`runPlatformAlertCheck` (`platformAlert.service.js`) runs on the `PLATFORM_ALERT_CRON` schedule (default every 5 minutes, `scheduler.service.js`) and evaluates the rules in `platformAlerts.js`. Each firing rule opens one episode per alert key (`status: 'active'`), and the next `ok` reading resolves it (`resolvedAt`); an `unknown` reading changes nothing.

| Code | Severity | Fires when |
|---|---|---|
| `HTTP_ERROR_RATE` | critical | The share of 5xx responses since the last run is above `ALERT_HTTP_ERROR_RATE` (default 0.05), over at least 20 requests. |
| `HTTP_LATENCY_P95` | warning | The p95 latency is above `ALERT_HTTP_P95_MS` (default 2500). |
| `QUEUE_UNAVAILABLE` | critical | A BullMQ queue cannot be read. |
| `QUEUE_BACKLOG` | warning | A queue holds more waiting and delayed jobs than `ALERT_QUEUE_BACKLOG` (default 100). |
| `QUEUE_FAILED` | warning | A queue's failed-job count rose since the last run. |
| `OUTBOX_DEAD_LETTER` | critical | The graph-projection outbox holds a `DEAD_LETTER` row. |
| `BACKUP_RPO` | critical | The newest successful backup is older than the policy's `rpoHours` (see [backup-restore-runbook.md](../operations/backup-restore-runbook.md), section 7). |
| `RESOURCE_MEMORY` | warning | The backend process uses more than `ALERT_MEMORY_RATIO` (default 0.9) of its memory limit. |
| `RESOURCE_DISK` | critical | The backend's root filesystem is fuller than `ALERT_DISK_RATIO` (default 0.9). |

Where they surface: `GET /api/monitoring/alerts` (`monitoring.routes.js`, Administrador only), the last evaluation and the active episodes.

### 1.3 Cold-chain incidents (`temperatureIncidents` collection)

A `TemperatureIncident` (`TemperatureIncident.js`) is a temperature excursion of a storage sensor, not a security incident: `sensorKey`, `sensorName`, current, maximum and minimum temperature, `samplesOutOfRange`, `status` (`open`, `acknowledged`, `escalated`, `resolved`), `escalationLevel` (0 notified, 1 supervisor, 2 critical) and `notes`. It is opened by `upsertTemperatureIncidentAndQuarantine` (`iot.controller.js`) when a reading is out of the sensor's policy range, or by `POST /api/incidents/create` (`createOrUpdateIncident`). One open incident per sensor; a new excursion updates it. Opening one also applies the cold-chain quarantine to the affected samples (`applyColdChainQuarantine`).

Where they surface: `GET /api/incidents` (permission `viewTemperature`).

## 2. Detection and notification

| Record | Who is notified | How | Settings |
|---|---|---|---|
| Security alert, severity `high` or `critical` | The one address in `ALERT_EMAIL_TO`. | `createEmailHandler` (`securityAlerts.service.js`), registered by `init` only when `ALERT_EMAIL_TO` is set, sends through `NotificationService.sendEmail` with `notificationType: 'SECURITY_ALERT'`. Every alert is also written to the log (`[ALERTS]`, the handler `initializeSecuritySystem` registers). | `ALERT_EMAIL_TO`; `EMAIL_FROM`; `RESEND_API_KEY`, or `SMTP_HOST` and `SMTP_PORT` for SMTP. With `ALERT_EMAIL_TO` empty, as `.env.production.example` ships it, no alert is e-mailed. |
| Security alert, severity `low` or `medium` | Nobody. | Stored and logged only. | None. |
| Platform alert episode, when opened | Whoever a NotificationRule for the event type `platform_alert` names. | `notificationDispatchService.dispatchNotification` (`platformAlert.service.js`), fire-and-forget; the opening is also logged at error level (`[PLATFORM_ALERT]`). With no such rule, nobody. | `PLATFORM_ALERT_CRON`, `ALERT_HTTP_ERROR_RATE`, `ALERT_HTTP_P95_MS`, `ALERT_QUEUE_BACKLOG`, `ALERT_MEMORY_RATIO`, `ALERT_DISK_RATIO`. |
| Cold-chain incident, when opened and at each escalation | Every active user holding the Tecnico, Coordenador or Administrador role (`NOTIFIABLE_ROLE_CODES`, `incident.controller.js`; the same list in `iot.controller.js`) with an e-mail address. | `sendIncidentAlertEmail` (`sendIncidentAlertEmail.js`), through Resend only, one message per recipient. | `RESEND_API_KEY` (without it nothing is sent and a warning is logged); `EMAIL_FROM`. |

## 3. Response

Each step names what the code gives the role that takes it. Where the code gives nothing, the step is not here but in section 6.

### 3.1 Triage

- Security alerts: the Administrador reads `GET /api/compliance/alerts`, then marks one `POST /api/compliance/alerts/:id/acknowledge` and closes it with `POST /api/compliance/alerts/:id/resolve`, whose body must carry a `resolution` text (both Administrador only). The row keeps `acknowledgedBy`, `acknowledgedAt`, `resolution`, `resolvedBy`, `resolvedAt`.
- Platform alerts: the Administrador reads `GET /api/monitoring/alerts`, and `GET /api/monitoring/metrics` and `GET /api/monitoring/runs` for the readings behind them. An episode is not acknowledged or closed by hand: it resolves when its rule next reads `ok`.
- Cold-chain incidents: a user with `manageTemperature` (Tecnico, Coordenador, Administrador) uses `PUT /api/incidents/:incidentId/acknowledge`, `PUT /api/incidents/:incidentId/escalate` (one level up, at most 2, and the e-mail goes out again at the new level) and `PUT /api/incidents/:incidentId/resolve`; a user with `viewTemperature` can add `POST /api/incidents/:incidentId/notes`. Resolving closes the open environmental excursion and marks the affected samples for post-incident review (`markColdChainReview`); they stay blocked until reviewed.

### 3.2 Audit-trail failure: verify the chain

On an `AUDIT_TRAIL_WRITE_FAILURE` alert, or to check the trail after any incident, the Administrador runs from `api/backend`, with the production `MONGO_URI` in the environment:

```bash
npm run audit:verify-chain
npm run audit:verify-witnesses
npm run audit:verify -- --event-id <eventId>
```

- `audit:verify-chain` (`audit-verify-chain.js`) checks each tree head in `audit_tree_heads` against the previous one (`previousTreeHeadHash`) and the consistency of the `audit_events` leaves. It prints `{ ok, failures }`; it exits 1 only when it cannot run, so a broken chain is read from `ok: false`, not from the exit code.
- `audit:verify-witnesses` (`audit-verify-witnesses.js`) lists each `audit_witnesses` row with no receipt, in the same shape.
- `audit:verify` (`audit-verify.js`) verifies one event, as `POST /api/audit/verify` does over HTTP (permission `viewReports`).

### 3.3 Locked administrator: clear an MFA lock

- One locked user, with an administrator still able to sign in: `POST /api/users/:id/reset-mfa` (permission `resetMFA`, which the seed grants to the Administrador role only).
- Every administrator locked: the break-glass script, run by someone with direct database access, from `api/backend`, with `MONGO_URI` set. It clears `mfaLocked` and `mfaFailedAttempts` for the one user named (`clearMfaLockForUser.js`):

```bash
npm run mfa:clear-lock -- <userId>
```

### 3.4 Suspected key compromise: rotate the encryption key

The order is the one `.env.production.example` gives (#1086, #1103):

1. Move the current `ENCRYPTION_KEY` and `ENCRYPTION_KEY_ID` into `ENCRYPTION_KEY_PREVIOUS` and `ENCRYPTION_KEY_PREVIOUS_ID`; the previous key needs its own id.
2. Put the new key and a new id into `ENCRYPTION_KEY` and `ENCRYPTION_KEY_ID`.
3. Recreate the services that read `.env.production` (see [configuration-runbook.md](../operations/configuration-runbook.md), section 3):

   ```bash
   npm run compose:prod:up
   ```

4. From `api/backend`, re-encrypt every registered field and re-derive the blind indexes, then dry-run:

   ```bash
   npm run encryption:rewrite -- --apply
   npm run encryption:rewrite
   ```

   Empty the previous-key slot only when the dry run prints `"safeToEmptyPreviousSlot": true`. Emptying it earlier is irreversible for the data still under the old key: those fields return null, and identity matches under the old blind index are lost. The rewrite also re-encrypts the DataFile binaries held in the object store and every DataFileVersion binary (`rewriteFileBinaries`, `fileBinaryRewrite.service.js`, called by `api/backend/src/scripts/rewriteEncryptedFields.js`); other file rows (legacy disk rows, backups, import source files) are only counted (`countFileRowsUnderOtherKey`), and `safeToEmptyPreviousSlot` stays false, so the slot stays filled, while any of them remain under the old key.

### 3.5 Data loss or corruption: restore

Restore per [backup-restore-runbook.md](../operations/backup-restore-runbook.md), section 8, after the restore test of section 9 on the same folder. What a restore does not cover (Neo4j, InfluxDB, Redis, file binaries, TSA and witness keys) is in that runbook's section 10.

## 4. Continuity

- Backup, off-site copy, restore, restore test, RPO and RTO: [backup-restore-runbook.md](../operations/backup-restore-runbook.md).
- Restart policies (`compose.prod.yml`): `mongodb`, `neo4j`, `influxdb`, `redis`, `tsa`, `witness`, `backend`, `worker`, `neo4j-projection-worker` and `frontend` run with `restart: unless-stopped`, so Docker restarts a container that exits unless an operator stopped it; each of them has a `healthcheck`. The one-shot jobs `foundation` and `essential-references` run with `restart: "no"`.
- The state of the stack and its logs:

  ```bash
  npm run compose:prod:ps
  npm run compose:prod:logs
  ```

- Everything runs on one Docker host, with every volume on it (`compose.prod.yml`); the TSA and witness volumes must survive a restart, as that file records, and are not backed up.

## 5. Periodic review

The register is reviewed when an issue it lists closes and at each release; see [risk-register.md](risk-register.md#review). Security exceptions and their deadlines are in [security-exceptions.md](security-exceptions.md). The code schedules no review of alerts or incidents (section 6).

## 6. Gaps

RNF013 C2, its incident-management and continuity part. Each row lists what is **not implemented**; none of it is a procedure the code runs. Tracking issue: #1472.

| Criterion | What the code does today | Gap |
|---|---|---|
| Security-incident record | `security_alerts` rows with an open, acknowledged, resolved status and a free-text `resolution`; cold-chain incidents in `temperatureIncidents`. | Not implemented: no security-incident entity that groups alerts into a case with a classification, impact, timeline, containment, root cause and closure review. |
| Incident notification to authorities and data subjects | None. | Not implemented: no record or workflow for notifying the data-protection authority or affected participants of a security incident (LGPD). |
| Security alert delivery | High and critical alerts are e-mailed to `ALERT_EMAIL_TO` when it is set; `.env.production.example` ships it empty. | Not implemented: no delivery of low or medium alerts, no second channel (`createSlackHandler` only logs and is registered nowhere), and no escalation or response deadline on a security alert. |
| Alert types | `REVOKED_ACCESS`, `PII_EXPOSURE` and `SECURITY_BYPASS_ATTEMPT` have methods. | Not implemented: no code raises them. |
| Cold-chain incident creation | `POST /api/incidents/create` takes no `authenticate` or permission middleware (`incident.routes.js`). | Not implemented: authentication on that route. |
| Escalation | Cold-chain escalation is by hand (`PUT /api/incidents/:incidentId/escalate`). | Not implemented: no time-based escalation of an unacknowledged cold-chain incident, security alert or platform alert episode. |
| Platform alert handling | Episodes open and resolve by rule; notified only through a `platform_alert` NotificationRule. | Not implemented: no acknowledgement or owner on an episode. |
| Audit-trail verification | `audit:verify-chain`, `audit:verify-witnesses` and `audit:verify` run by hand. | Not implemented: no scheduled verification of the audit chain, and `audit:verify-chain` exits 0 on a broken chain. |
| Continuity plan | Restart policies and healthchecks on one host; backups per the backup runbook. | Not implemented: no failover or second host, no documented recovery exercise of the full stack, and the backup gaps of [backup-restore-runbook.md](../operations/backup-restore-runbook.md) section 10. |
| Periodic review | The risk register's review cadence (by issue close and release). | Not implemented: no scheduled or recorded review of security alerts, platform alert episodes or cold-chain incidents. |
