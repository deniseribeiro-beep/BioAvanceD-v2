# 2026-11-17: RNF028 C1: each layer is kept apart by a named architecture test

Requirements: RNF028 C1. Issue #1574.

## The question

RNF028 C1 says "Separar escrita canônica, projeções, interoperabilidade, telemetria, objetos e apresentação" (`docs/extracted-v2.0.0/requisitos.md`, RNF028). Boundary tests existed for some of these layers, but nothing listed which test keeps which layer apart, and objects and presentation had none. Which test keeps each layer apart, and what does it pin?

## Decided

`[inference]`, from the specification and the repo's pattern, for #1574, on 2026-11-17. The pattern: an architecture test pins a boundary by reading every source file, and a decision records why each entry is on the right side of it, as `2026-11-14-redis-transient-only.md` does.

1. **Canonical write and projections:** `api/backend/tests/architecture/neo4j-boundary.arch.test.js` pins that only the projector that applies outbox events writes Neo4j (a source file that runs Cypher and holds a write clause is listed or fails), and `api/backend/tests/architecture/ingestion-civil-data-boundary.arch.test.js` pins that no outbox payload carries a civil identity field, so a projection holds no civil data.
2. **Interoperability:** `api/backend/tests/architecture/fhir-boundary.arch.test.js` pins that the retired FHIR-first stores and sync paths stay gone from the backend.
3. **Telemetry:** `api/backend/tests/architecture/temperatures-copy-retired.arch.test.js` pins that InfluxDB is a reading's only store (no backend code names the retired Mongo `temperatures` collection), and `api/backend/tests/architecture/influxdb-retention.arch.test.js` pins that the retention the compose files apply to the bucket equals the one the telemetry model document states.
4. **Transient state:** `api/backend/tests/architecture/redis-transient-only.arch.test.js` pins that every file that reaches Redis is listed with what it keeps there, so Redis holds only cache and transient data (`2026-11-14-redis-transient-only.md`).
5. **Objects (new):** `api/backend/tests/architecture/object-storage-boundary.arch.test.js` pins that a DataFile binary reaches the object store through `getFileObjectStore`: the files outside `src/infrastructure/objectStorage/` that require one of its adapter modules, and the files that name a local disk root (`STORAGE_BASE`, `UPLOADS_BASE`, `UPLOAD_ROOT`), are each listed with a reason, and the lists equal what the scan finds, so a new file fails until it is reviewed and a stale entry fails too.
6. **Presentation (new):** `api/backend/tests/architecture/presentation-boundary.arch.test.js` pins that no shipped frontend file imports a path outside `frontend/` or a store client package, that `frontend/package.json` declares no store client package, and that no backend file imports a path under `frontend/` or calls `res.render(`.

## Not decided here

- **The two `legacy:` disk writers.** `result.routes.js` (result files) and `consentEvidence.service.js` (consent evidence under an `objstore://` URI without `getFileObjectStore`) stay where they are: listed, not moved.
- **A disk write that names no root.** A hard-coded path or `os.tmpdir()` is not seen by the object test, which reads only the three root names.
- **A frontend import through a bundler alias.** The presentation test reads only the specifier text, so an alias that resolves into the backend is not seen.
- **A tree without the frontend.** The presentation test skips where the repo tree is not reachable (inside the backend-unit-runner image), as `container-hardening.arch.test.js` does.
