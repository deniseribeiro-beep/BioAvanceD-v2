# Graph projection outbox runbook

Answers RNF006 C2 ("Documentar instalação, configuração, backup, restauração, APIs, eventos, outbox e troubleshooting.") for the events and the outbox. Written 2026-11-13. It describes what the code does at this commit, nothing more; everything ADR-V2-002, ADR-V2-010 and RNF006 C2 ask of the outbox that the code does not do is listed under [Gaps](#8-gaps), never as a procedure. Tracking issue: #1472.

Sources: `api/backend/src/services/neo4jOutbox.service.js`, `api/backend/src/workers/neo4jProjection.worker.js`, `api/backend/src/services/graphProjection.service.js`, `api/backend/src/services/neo4jCanonicalProjection.service.js`, `api/backend/src/utils/mongoTransaction.js`, `api/backend/src/config/env.js`, `api/backend/scripts/graph-projection-reconcile.js`, `api/backend/scripts/neo4j-canonical-rebuild.js`, `api/backend/package.json`, `api/backend/src/infrastructure/metrics/platformAlerts.js`, `api/backend/src/services/platformAlert.service.js`, `api/backend/src/services/scheduler.service.js`, `api/backend/src/interface/routes/monitoring.routes.js`, `api/backend/src/interface/routes/graphProjectionTestSupport.routes.js`, `api/backend/src/utils/testSupportGate.js`, `compose.prod.yml`, `api/backend/Dockerfile.prod`, the event producers named in section 2, `docs/decisions/2026-11-12-outbox-not-configurable.md`, `docs/decisions/2026-11-12-quarantine-apply-outbox-event.md`, `docs/decisions/2026-11-12-quarantine-release-outbox-event.md`, `docs/extracted-v2.0.0/persistencia-poliglota.md` (sections 4 and 13), `docs/BioAvanceD_Pacote_Exemplos_JSON_Persistencia_Poliglota_v2.0.0/10_graph_projection_outbox_mongodb.json`.

## 1. What the outbox is

- MongoDB is the source; Neo4j is a projection rebuilt from it. `docs/extracted-v2.0.0/persistencia-poliglota.md` section 13: ADR-V2-002 "MongoDB operacional e outbox; Neo4j derivado", consequence "Sem dual-write; replay e reconciliação"; ADR-V2-010 "Grafo temporal idempotente via outbox", consequence "Intervalos, versões, checkpoint e rebuild".
- A write that has a graph side appends an event to the MongoDB collection `graph_projection_outbox` (`COLLECTION_NAME` in `neo4jOutbox.service.js`). No request writes to Neo4j for it. The `neo4j-projection-worker` service (`compose.prod.yml`, command `node src/workers/neo4jProjection.worker.js`, the same file as `npm run neo4j:canonical:worker`) reads the collection and applies each event to Neo4j through `Neo4jCanonicalProjectionService.applyEvent`.
- Two more MongoDB collections belong to it: `graph_projection_outbox_aggregate_versions` (one version counter per aggregate, `nextAggregateVersion`), and `graph_projection_checkpoints` (`CHECKPOINT_COLLECTION_NAME`, one checkpoint per projector and aggregate).
- No setting turns the outbox off. A configuration release that names `outbox` is refused with 422 naming `INV-SCOPE-001` (`docs/decisions/2026-11-12-outbox-not-configurable.md`). The worker's own tuning is four environment variables read by `api/backend/src/config/env.js`, none validated there (a non-numeric value is `NaN`, and each call site then falls back to its default):

| Variable | Default | Used for |
|---|---|---|
| `GRAPH_OUTBOX_BATCH_SIZE` | 100 | events leased per pass (`leaseNextBatch`) |
| `GRAPH_OUTBOX_MAX_ATTEMPTS` | 8 | tries before an event becomes `DEAD_LETTER` |
| `GRAPH_OUTBOX_LEASE_MS` | 300000 (5 min) | how long a leased event may stay `PROCESSING` |
| `GRAPH_OUTBOX_RETRY_BACKOFF_MS` | 1000 | base retry delay, and the worker's idle sleep |

The longest retry delay is the module constant `MAX_RETRY_BACKOFF_MS` (5 min), not a variable.

### 1.1 In a transaction, or after the write

`withTransactionWhereSupported` (`api/backend/src/utils/mongoTransaction.js`) runs the aggregate write and its `appendEvent` in one MongoDB transaction when the server is a replica set or a mongos, and as two sequential writes without a session otherwise. The `mongodb` service of `compose.prod.yml` starts without `--replSet` (`compose.test.yml` passes it), so on that stack the event is written after the aggregate, not with it. Where a caller appends after a committed write, a failed append is logged and does not fail the request: `recordSpecimenProjection` logs `[NEO4J_OUTBOX] SPECIMEN_UPSERTED nao registrado para <id>: <error>`, `recordLineageProjection` logs `[NEO4J_OUTBOX] LINEAGE_REGISTERED nao registrado para <id> <- <parent>: <error>` (`graphProjection.service.js`). Section 6 is how such a sample is repaired.

## 2. Events: who writes them and what they carry

### 2.1 Event types

Every append goes through `Neo4jOutboxService.appendEvent`, mostly by way of a `GraphProjectionService` method (`graphProjection.service.js`).

| Event type | Aggregate | Appended by | Projected |
|---|---|---|---|
| `CONSENT_UPSERTED`, `CONSENT_REVOKED` | `EthicalConsent` | `consent.service.js` (`appendConsentEvent`), `api/backend/src/ingestion/consentTarget.js`, the rebuild script | yes |
| `SPECIMEN_UPSERTED` | `Sample` | `sample.service.js`, `insertSampleWithProjection` (called by `import.service.js` and `import-lgpd.service.js`), `api/backend/src/ingestion/specimenTarget.js`, the reconcile and rebuild scripts | yes |
| `LINEAGE_REGISTERED` | `Sample` | `sample.service.js`, `specimenTarget.js` (`appendLineageEvents`), the rebuild script | yes |
| `QUALITY_ASSESSED` | `Sample` | the rebuild script only; `appendQualityEvent` has no caller under `api/backend/src` | yes |
| `TELEMETRY_INCIDENT_RECORDED` | `Sample` | nothing; `appendTelemetryEvent` has no caller | yes |
| `STORAGE_POSITION_ASSIGNED` | `Sample` | `storageService.js`, the reconcile script | yes |
| `CUSTODY_EVENT_RECORDED` | `Sample` | `LineageRepository.js` (`appendCustodyEvent`) | yes |
| `SPECIMEN_COMPROMISED` | `Sample` | `TelemetryMonitor.js` | yes |
| `TERMINOLOGY_CONCEPT_PROMOTED`, `TERMINOLOGY_RELATION_PROMOTED` | `TerminologyConcept`, `TerminologyRelation` | `referenceRelease.service.js` | yes |
| `QUARANTINE_APPLIED`, `QUARANTINE_RELEASED` | `QuarantineAction` | `quarantine-action.service.js`, `quarantine-release.service.js` | no handler (the two quarantine decision files) |
| `INGESTION_RECORD_PERSISTED` | the ingested entity type | `api/backend/src/ingestion/productionIngestion.js` | no handler |

An event type `applyEvent` has no branch for returns `{ skipped: true }` without throwing, so the worker records its checkpoint and marks it `PROJECTED` like an applied one (section 3). A `PROJECTED` row therefore does not prove the graph changed.

### 2.2 The fields of an event

`buildEvent` writes every row with these fields:

| Field | Value |
|---|---|
| `eventId` | the caller's, else a random UUID; unique index `graph_projection_outbox_eventId_unique` |
| `eventType`, `eventTypeVersion` | the type; the version defaults to `'1'` |
| `aggregateType`, `aggregateId` | the aggregate; together they are the partition key `<aggregateType>:<aggregateId>` (`partitionKeyOf`) |
| `aggregateVersion` | the caller's, else the next value of the aggregate's counter in `graph_projection_outbox_aggregate_versions`, taken in the caller's session |
| `idempotencyKey` | section 4; unique index `graph_projection_outbox_idempotencyKey_unique` over rows that carry a string key |
| `canonicalModelReleaseId` | the caller's, else `CANONICAL_MODEL_RELEASE_ID` (`api/backend/src/foundation/readiness.js`) |
| `payload`, `payloadHash` | the event's data and a sha256 of it with sorted keys (`hashPayload`). The payloads carry ids, codes and pseudonymous references; the quarantine decisions record "No civil field" |
| `schemaVersion` | default 1 |
| `occurredAt`, `createdAt`, `updatedAt` | timestamps |
| `status` | `PENDING` on append; then `PROCESSING`, `RETRYING`, `PROJECTED` or `DEAD_LETTER` |
| `attempts`, `lastError`, `nextAttemptAt`, `leaseUntil` | the retry state of section 3 |
| `projectedAt`, `processedAt` | set when the event leaves the queue |
| `sourceService` | the writer's name, else `unknown` |
| `traceId` | the caller's, else the request id (`currentRequestId`); the projector passes it to Neo4j as transaction metadata |
| `projectionState` | free object, default `{}` |

`appendEvent` writes with `updateOne({ eventId }, { $setOnInsert: ... }, { upsert: true })`, so appending an `eventId` that is already there changes only its `updatedAt`.

## 3. The worker loop

`runProjectionWorker` (`neo4jProjection.worker.js`) repeats `runProjectionOnce` until SIGTERM or SIGINT, which stop it after the current pass (`[GRAPH_OUTBOX] SIGTERM recebido, encerrando worker...`). After each pass it writes the time to `/tmp/neo4j-projection-heartbeat`; when a pass leased nothing it sleeps `GRAPH_OUTBOX_RETRY_BACKOFF_MS`. One pass:

1. **Sweep stale leases** (`rescheduleStaleProcessing`). An event whose tries are spent (`attempts >= GRAPH_OUTBOX_MAX_ATTEMPTS`) and that is `RETRYING`, or `PROCESSING` with `updatedAt` older than `GRAPH_OUTBOX_LEASE_MS`, becomes `DEAD_LETTER` with `lastError: 'processing_lease_expired'`, logged as `[GRAPH_OUTBOX] DEAD_LETTER: lease expirado na última tentativa` (`deadLetterExhausted`). Any other stale `PROCESSING` event goes back to `RETRYING` with the same `lastError`, without counting another try.
2. **Lease a batch** (`leaseNextBatch`). The same sweep again, with `lastError: 'leased_processing_timeout'`. Then up to `GRAPH_OUTBOX_BATCH_SIZE` events that are `PENDING` or `RETRYING`, have `attempts` below the limit and whose `nextAttemptAt` is null or past, sorted by `aggregateType`, `aggregateId`, `aggregateVersion`, `occurredAt`, `_id`. They are set to `PROCESSING`, `leaseUntil` = now plus the lease, and `attempts` + 1.
3. **Per event, in that order**, for an event whose `aggregateVersion` is an integer:
   - the projector's checkpoint (`PROJECTOR_NAME` = `neo4j-canonical-projection`) for the aggregate is at or past this version: marked `PROJECTED` without applying it (counted `skipped`);
   - an earlier version of the same aggregate is still `PENDING`, `RETRYING`, `PROCESSING` or `DEAD_LETTER` (`findEarlierUnprojectedVersion`): put back to `RETRYING` and its try given back (`markDeferred`, `attempts` - 1), with `lastError: 'awaiting_earlier_aggregate_version'` and a wait of the base delay, or, when the earlier one is a dead letter, `lastError: 'awaiting_dead_letter_repair'` and a wait of `MAX_RETRY_BACKOFF_MS`. A dead letter therefore holds every later version of its aggregate until it is repaired (section 6).
4. **Apply** with `projector.applyEvent` in one Neo4j session on `NEO4J_DATABASE` (default `neo4j`). On success the checkpoint is recorded first (`recordCheckpoint`: `$max` on `lastAggregateVersion`, so it never moves back, then `lastEventId`), then the event is marked `PROJECTED` (`projectedAt`, `processedAt`, `lastError: null`). A crash between the two leaves an event the next pass skips by step 3, not one it applies twice.
5. **On a failure**: when the event's `attempts` (already counted by the lease) reached `GRAPH_OUTBOX_MAX_ATTEMPTS`, it becomes `DEAD_LETTER` with the error in `lastError` (`markDeadLetter`), logged as `[GRAPH_OUTBOX] DEAD_LETTER: evento parou após o limite de tentativas`, with `eventId`, `eventType`, `aggregateType`, `aggregateId`, `aggregateVersion`, `attempts` and `error`. Otherwise it becomes `RETRYING` with the error in `lastError` and `nextAttemptAt` = now + `retryDelayMs(attempts)`: `GRAPH_OUTBOX_RETRY_BACKOFF_MS` × 2^(attempts − 1), capped at `MAX_RETRY_BACKOFF_MS`. With the defaults the waits are 1, 2, 4, 8, 16, 32 and 64 s, and the eighth failure is a dead letter. Either way `[GRAPH_OUTBOX] Falha ao projetar evento` is logged as a warning.

Each pass returns `{ processed, projected, failed, skipped, deferred }`; the long-running worker does not log it.

The worker exits 1 on `[GRAPH_OUTBOX] Worker falhou:` (a pass threw, for example MongoDB or Neo4j unreachable at `connectDB` or `connectNeo4j`) and on an unhandled rejection or exception (`[GRAPH_OUTBOX] [#1040] ...`); `restart: unless-stopped` in `compose.prod.yml` restarts the container.

## 4. Idempotency

- **One row per event**: the unique index on `eventId` and the `$setOnInsert` upsert (section 2.2). `appendEvent` builds the indexes once per process (`ensureIndexes`); a failed build is logged as `[NEO4J_OUTBOX] Falha ao criar indices de graph_projection_outbox: ...` and the append goes on without the unique index.
- **One key per aggregate version**: `buildIdempotencyKey` is a sha256 over `aggregateType`, `aggregateId`, `aggregateVersion`, `eventType`, `eventTypeVersion` and `payloadHash`, joined by `|`. The same event appended again keeps its key; two versions of one aggregate never share one.
- **Versions in order, once per projector**: the per-aggregate counter, the ordering of step 3 and the checkpoint of step 4. An event at or below the checkpoint is never applied again.
- **Graph writes that converge**: `applySpecimenProjection` in `neo4jCanonicalProjection.service.js` writes the `Sample` and `Donor` nodes and the `DONATED` edge with `MERGE`, so applying the same `SPECIMEN_UPSERTED` twice leaves one of each; `applyStoragePositionProjection` merges its nodes the same way.

## 5. Seeing a backlog or a failed event

What the code gives an operator, and nothing more:

- **Alert `OUTBOX_DEAD_LETTER`** (`platformAlerts.js`), subject `graph_projection_outbox`, severity `critical`, threshold 0. Every run of the platform alert check counts `graph_projection_outbox` rows with `status: 'DEAD_LETTER'` (`readDeadLetter`, `platformAlert.service.js`) and fires when the count is above 0. The check runs in the `backend` process on `PLATFORM_ALERT_CRON` (default every 5 minutes, `scheduler.service.js`). A new episode is a row in `platformAlerts`, the error log line `[PLATFORM_ALERT] OUTBOX_DEAD_LETTER graph_projection_outbox valor=<count> limite=0`, and a `platform_alert` notification, sent only where a notification rule for it exists. The episode resolves when the count is back to 0 (`[PLATFORM_ALERT] OUTBOX_DEAD_LETTER graph_projection_outbox resolvido`). A count that cannot be read leaves it `unknown` and logs `[PLATFORM_ALERT] contagem de DEAD_LETTER indisponível`.
- **`GET /api/monitoring/alerts`** (`monitoring.routes.js`, authenticated, role 4, Administrador): the last evaluation's rows and the active episodes. `GET /api/monitoring/metrics` holds HTTP and BullMQ queue figures only, nothing from the outbox.
- **Logs** of the `neo4j-projection-worker` container, all prefixed `[GRAPH_OUTBOX]`: the two `DEAD_LETTER` lines (steps 1 and 5 of section 3) as errors, `Falha ao projetar evento` as a warning per failed try, `Falha ao gravar heartbeat` when the heartbeat file cannot be written.
- **Container health**: the `neo4j-projection-worker` healthcheck in `compose.prod.yml` fails when `/tmp/neo4j-projection-heartbeat` is older than 60 s (interval 15 s, 4 retries, 60 s start period). A pass that hangs past that, or a worker that is not running, shows as `unhealthy`.

```sh
docker compose -f compose.prod.yml ps neo4j-projection-worker
docker compose -f compose.prod.yml logs neo4j-projection-worker
```

- **The reconcile report** (section 6.1), run without `--repair`, changes nothing and logs the aggregates the projection has stopped on.
- **The rows themselves**: an event's `status`, `attempts`, `lastError` and `nextAttemptAt` in `graph_projection_outbox`. `lastError` holds the projector's error message, or one of `processing_lease_expired`, `leased_processing_timeout`, `awaiting_earlier_aggregate_version`, `awaiting_dead_letter_repair`. A row with `awaiting_earlier_aggregate_version` waits on its own aggregate; one with `awaiting_dead_letter_repair` waits on a dead letter.

There is no alert, route or metric for a backlog of `PENDING` or `RETRYING` events (section 8).

## 6. Replay and rebuilding Neo4j

Both scripts are in `api/backend/scripts/`, which the production image carries (`Dockerfile.prod` copies the backend tree and removes only the tests). They read the same environment as the API (`MONGO_URI`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, `NEO4J_DATABASE`). From `api/backend` with its `.env`, or inside the production stack through the `backend` service:

### 6.1 Reconcile: find and requeue

```sh
npm run neo4j:projection:reconcile
npm run neo4j:projection:reconcile -- --repair
docker compose -f compose.prod.yml exec backend node scripts/graph-projection-reconcile.js
docker compose -f compose.prod.yml exec backend node scripts/graph-projection-reconcile.js --repair
```

`reconcile` (`api/backend/scripts/graph-projection-reconcile.js`) reads; with `--repair` it then writes to MongoDB only (its Neo4j session is `READ`):

- **Stalled aggregates** (`findUnprojectedAggregates`): an aggregate whose counter is ahead of the `neo4j-canonical-projection` checkpoint with no later event still queued, each with its dead letters. `--repair` requeues those dead letters (`requeueDeadLetters`: `PENDING`, `attempts: 0`, `lastError` kept as the record) and releases every event waiting with `awaiting_dead_letter_repair`. A stalled aggregate with no dead letter took a version no event holds (a write that failed outside a transaction) and is reported under `needsRebuild`.
- **Samples missing from the graph** (`findSamplesMissingFromGraph`): a MongoDB sample with no `Sample` node. `--repair` appends its `SPECIMEN_UPSERTED` again.
- **Samples drifted from MongoDB** (`findSamplesDriftedFromGraph`): a donor or an open `STORED_AT` position that differs. `--repair` appends a `SPECIMEN_UPSERTED` for a missing donor edge and a `STORAGE_POSITION_ASSIGNED` for a wrong position; a donor edge that should not exist, or an open position for a sample MongoDB holds nowhere, has no event that removes it and is reported under `driftNeedsRebuild`.

It logs `[GRAPH_OUTBOX] Reconciliação da projeção` with the counts, then one `Agregado sem projeção` line per stalled aggregate and one `Nó Sample divergente do Mongo` line per drifted sample. A requeued event that fails again returns to `DEAD_LETTER` after `GRAPH_OUTBOX_MAX_ATTEMPTS` tries, so read its `lastError` and fix the cause before `--repair`.

### 6.2 Rebuild: re-append from MongoDB

```sh
npm run neo4j:canonical:rebuild
docker compose -f compose.prod.yml exec backend node scripts/neo4j-canonical-rebuild.js
```

`api/backend/scripts/neo4j-canonical-rebuild.js` builds the outbox indexes (a failure stops it), appends events from MongoDB with `sourceService: 'neo4j-canonical-rebuild'` (`seedCanonicalOutbox`): one `CONSENT_UPSERTED` or `CONSENT_REVOKED` per `consents` row, one `SPECIMEN_UPSERTED` per `samples` row, one `QUALITY_ASSESSED` per sample with a `quality`, one `LINEAGE_REGISTERED` per stored parent. It then runs `runProjectionOnce` with batches of 100 until a pass leases nothing or 100 passes have run, and logs `[GRAPH_OUTBOX] Reconstrução canônica concluída`; what is left is drained by the worker. Each run appends new events (new `eventId`, next aggregate version), so they pass the checkpoint and are applied.

It deletes nothing in Neo4j, and it re-emits no storage position, custody, compromise, terminology or quarantine event; the code does not stop the `neo4j-projection-worker` during a rebuild. See section 8.

### 6.3 The test-support route is not a procedure

`POST /api/_test-support/graph-projection/reconcile` (`graphProjectionTestSupport.routes.js`) calls the same `reconcile`, scoped to at most 50 named samples. It exists only when `NODE_ENV` is not `production` and `ENABLE_TEST_SUPPORT_ROUTES` is `true`, behind the `x-test-support-secret` header (`testSupportGate.js`); it serves the e2e suite and is not a production procedure.

## 7. Related documents

[backup-restore-runbook.md](backup-restore-runbook.md) (the Neo4j export, and that it is not restored), [troubleshooting-runbook.md](troubleshooting-runbook.md), [configuration-runbook.md](configuration-runbook.md).

## 8. Gaps

| Criterion | What the code does today | Gap |
|---|---|---|
| RNF006 C2, outbox observability | `OUTBOX_DEAD_LETTER` fires on any dead letter; the worker's container health shows a stopped or hung loop (section 5). | Not implemented: no alert, route or metric for the number or age of `PENDING` and `RETRYING` events, for the projection lag, or for events whose type the projector skips. |
| ADR-V2-010, rebuild ("checkpoint e rebuild") | The rebuild re-appends consent, sample, quality and lineage events and applies them over the existing graph with `MERGE` (section 6.2). | Not implemented: no rebuild from an empty graph: nothing clears Neo4j or the checkpoints first, so a node or edge MongoDB no longer holds stays, and storage position, custody, compromise and terminology events are not re-emitted. |
| ADR-V2-002, replay ("replay e reconciliação") | Requeue of dead letters and re-append of sample events (section 6.1). | Not implemented: no replay of events already `PROJECTED` in `graph_projection_outbox` (a reset of their status or of the checkpoints); only dead letters are requeued, and any other replay is new events. |
| ADR-V2-002, no lost event | On a replica set the event commits with its write; `compose.prod.yml` runs a standalone `mongodb`, where the append follows the write and a failed append is only logged (section 1.1). | Not implemented: a transactional append on the production compose stack. |
| Worker claim | `leaseNextBatch` reads a batch, then sets it to `PROCESSING` by `eventId` with no status condition; `compose.prod.yml` runs one `neo4j-projection-worker`. | Not implemented: an atomic claim; two workers, or the rebuild script beside the worker, can lease the same event. |
| Quarantine and ingestion events | `QUARANTINE_APPLIED`, `QUARANTINE_RELEASED` and `INGESTION_RECORD_PERSISTED` are appended and marked `PROJECTED` without a handler (section 2.1). | Not implemented: a Neo4j projection of these events. |
| Canonical event shape | The v2.0.0 example `10_graph_projection_outbox_mongodb.json` carries `operation`, `relationships` with `validTime` and `transactionTime`, `projectionSchemaVersion` and an `idempotencyKey` of the form `<aggregateType>:<aggregateId>:<version>`. The code's event carries `eventType` and `payload`, and a sha256 `idempotencyKey` (section 4). | Not implemented: the example's event shape and key form. |
| Dead-letter handling | Requeue only through the reconcile script, for aggregates it finds stalled (section 6.1). | Not implemented: no route or screen to list, inspect, requeue or discard a dead letter. |
