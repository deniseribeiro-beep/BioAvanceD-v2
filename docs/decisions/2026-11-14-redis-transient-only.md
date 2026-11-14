# 2026-11-14: RNF016 C5: Redis holds only cache and transient queues, and each consumer is listed

Requirements: RNF016 C5. Issue #1554. Follows `2026-11-12-ingestion-transient-state-telemetry-and-atomicity.md`.

## The question

RNF016 C5 says "Redis contém apenas cache, locks e dados transitórios" (`docs/extracted-v2.0.0/requisitos.md`, RNF016). Nothing listed what the backend keeps in Redis, so nothing would notice a new consumer that stored a record of the data model there. What does each consumer keep, and what holds the list?

## Decided

`[inference]`, from the specification and the repo's pattern, for #1554, on 2026-11-14. The pattern: an architecture test pins a boundary by reading every source file, as `fhir-boundary.arch.test.js` and `schema-index-built.arch.test.js` do, and a decision records why each entry is on the right side of it.

1. **Every file that reaches Redis is listed with what it keeps there**, in `api/backend/tests/architecture/redis-transient-only.arch.test.js`. A file reaches Redis when it requires or imports a package whose name holds `redis` (`redis` and its `@redis/*` parts, `ioredis`, `redis-om`, `@upstash/redis`, `connect-redis`) or starts with `bull` or `@bull` (`bull`, `bullmq`), or `src/config/redis.js` or `src/config/queue.js`. A new consumer fails the test until it is reviewed and listed.
2. **Cache: the dictionary's terminology lookups** (`api/backend/src/routes/dictionary.js`), written only with `setEx`, so each entry expires. The test allows only `get`, `setEx`, `connect`, `on` and `isOpen` to be called on a name the file binds to its client, so any other member called there, an expiry-less `set` included, fails it.
3. **Transient: the BullMQ queues and their workers.** The import queue (`src/config/queue.js`) and the notification queue (`src/services/NotificationService.js`) remove a completed job after 24 hours and a failed one after 7 days. A job carries work in flight (an import, a notification, a streamed reading on its way to InfluxDB); the record it produces is written to its own store, MongoDB or InfluxDB.
4. **Transient: the two retry lists for the graph** (`src/infrastructure/queue/Neo4jQuarantineService.js` and `TopologicalQuarantine.js`). Each holds a lineage write or a custody event the graph or its outbox refused, until a retry records it. The specimen itself is already in MongoDB, and Neo4j is a projection derived from the outbox (RNF016 C2), so a retry list is work in flight, not a source of record.
5. **No locks are kept in Redis today.** A lock added later is a listed consumer like any other.

## Not decided here

- **A retry item dropped after its last attempt.** `TopologicalQuarantine` discards an event after `NEO4J_RETRY_MAX_ATTEMPTS`; whether that event must be recovered from MongoDB is a question for the outbox, not for Redis.
- **The app-wide rate limiters' memory store.** As `2026-11-12-ingestion-transient-state-telemetry-and-atomicity.md` left it.
- **A consumer reached through more than one module hop.** The test lists a file that requires a Redis package or `src/config/redis.js` or `src/config/queue.js` directly; a file that reaches Redis only through another module (a service that calls `NotificationService`) is not listed, and what it puts in Redis is the listed module's to bound.
- **What a listed consumer other than the dictionary writes.** Only `src/routes/dictionary.js` has its client calls checked against an allow-list; the queues and retry lists are bounded by their own job and retry options, not by this test.
- **A dictionary write that does not go through a client binding.** The write check reads only members called on a name bound by `createClient(` or `getRedisClient(`, so an aliased client (`const r = client`), a destructured member (`const { set } = client`) or an unbound call (`(await getRedisClient()).set(...)`, a `.then` callback's parameter) is not seen.
