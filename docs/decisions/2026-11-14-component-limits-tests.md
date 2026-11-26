# 2026-11-14: capacity is measured outside CI, and the tests that document each store's indexes, partitioning and limits

Issue #1554. Cites RNF016 C7 without deciding it: three of its parts are testable and have no test yet (#1555), so the criterion stays open until they do.

## The question

RNF016 C7 says "Testes documentam capacidade, índices, particionamento e limites por componente" (`docs/extracted-v2.0.0/requisitos.md`, RNF016). No test named the criterion. Which tests document each persistence component today, which parts can a test still reach, and which part can none?

## Decided

`[inference]`, from the specification and the repo's pattern, for #1554, on 2026-11-14. The pattern: a criterion is proven where the behaviour it names lives, by the instrument that can reach it, and a part no instrument reaches yet is named rather than claimed (`2026-11-12-ingestion-transient-state-telemetry-and-atomicity.md`). C7 is read per component (RNF016 C1-C5: MongoDB, Neo4j, InfluxDB, Object Storage, Redis) and per property.

1. **MongoDB, indexes:** `api/backend/tests/architecture/schema-index-built.arch.test.js` ("every index a Mongoose schema declares is built natively (#941)"), `api/backend/tests/architecture/schema-index-duplication.arch.test.js` ("no Mongoose schema declares one index name twice (#1039)") and `api/backend/tests/unit/sampleIndexes.unit.test.js` ("#936 ensureSampleIndexes"). **Partitioning:** none; the deployment is one replica set with no sharding, so there is no shard key to document.
2. **InfluxDB, partitioning:** a reading is written to its measurement with `sensorId`, `clockStatus`, `datastreamId` and `storageLocationId` as tags, the series key Influx partitions by: `api/backend/tests/unit/saveTelemetryPoint.test.js` ("writes the reading id as a field and clockStatus, datastreamId and storageLocationId as tags when given an identity"). **Limits:** a report reads a bounded range, paged: `api/backend/tests/unit/InfluxTelemetryReadRepository.test.js` ("temperatureReport bounds the range by the given start and stop", "temperatureReport pages the rows by the given offset and leaves the count unlimited").
3. **Redis, limits:** a queued job is removed 24 hours after it completes, at most 1000 kept, and 7 days after it fails: `api/backend/tests/unit/queue.config.test.js` ("happy path constructs Queue and QueueEvents with the expected name/options and wires listeners"). What Redis may hold is listed by `api/backend/tests/architecture/redis-transient-only.arch.test.js` (`2026-11-14-redis-transient-only.md`).
4. **Capacity of every component (volume and throughput) is measured outside CI.** It is the only part of RNF016 C7 no CI test can reach: it needs a load test against the running stack, with the institution's hardware and data volume, so its proof is that load test's report, not a test in this repo.

## Not decided here

No test documents these yet, and a CI test can reach each one; #1555 tracks them, and RNF016 C7 is not decided until they are tested:

- **Neo4j's constraints and indexes**, declared in `api/backend/src/infrastructure/database/neo4j/schema/001_iso20387_constraints_indexes.cypher` and `002_canonical_projection.cypher` (#1555).
- **InfluxDB's bucket retention**, written only as prose in `api/backend/src/infrastructure/database/influxdb/schema/telemetry_model_and_retention.md` (#1555).
- **Object Storage's upload limit**, 500 MB in `api/backend/src/config/uploadConfig.js` and `api/backend/src/controllers/createLinkedFileController.js` (#1555).
