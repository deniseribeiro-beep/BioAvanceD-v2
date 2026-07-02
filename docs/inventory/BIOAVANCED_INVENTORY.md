# BioAvanceD Technical Inventory

## Scope

This inventory describes the repository structure without binding the project to a named host, public IP address, institution-specific path, or deployment branch.

## Architecture

- Frontend: `frontend/`, React and Vite.
- Backend: `api/backend/`, Node.js and Express.
- Document persistence: MongoDB.
- Graph persistence: Neo4j.
- Time-series persistence: InfluxDB.
- Cache and queues: Redis.
- Runtime definition: `docker-compose.yml`.
- Runtime configuration example: `.env.docker.example`.
- Automated checks: backend tests, frontend type checking, Playwright, audit scripts, and Compose smoke test.

## Core domains

- authentication and RBAC;
- patients and donors;
- biospecimens and storage;
- TCLE and dynamic consent;
- FHIR ingestion;
- ORPHA and clinical terminology;
- RCS-GOV, SPREC, and MIABIS;
- audit hashes and Merkle trees;
- sample lineage and custody;
- sensors, telemetry, and cold-chain incidents;
- logical quarantine and release governance.

## Containerized services

The canonical Compose stack defines:

- `mongodb`;
- `neo4j`;
- `influxdb`;
- `redis`;
- `backend`;
- `frontend`.

Database state and Node dependency directories use named volumes. Host ports are configurable through environment variables. Application source directories are mounted for development, while semantic input and generated artifacts use explicit workspace mounts.

## Environment variables

The example environment file groups variables by responsibility:

- application runtime and URLs;
- authentication and encryption;
- MongoDB;
- Neo4j and lineage behavior;
- Redis;
- InfluxDB;
- MQTT and telemetry;
- CORS;
- feature flags for external integrations;
- email notifications.

Real secrets and runtime data are not part of the repository.

## Portability checks

The environment-neutral workflow uses:

```text
npm run compose:config
npm run compose:up
npm run compose:ps
npm run compose:smoke
npm run compose:down
```

The smoke test verifies frontend, backend, MongoDB, Neo4j, Redis, and InfluxDB without hardcoded public endpoints or host-specific paths.

## Scientific data pipelines

The repository includes a versioned ORPHA artifact pipeline with source attribution, normalization, checksums, validation, batch import, checkpoints, and post-import validation. HPO and biomarker data remain separate semantic domains and require dedicated pipelines.

## Current critical technical work

- complete PT, EN, ES, and SNOMED coverage in the ORPHA builder and validator;
- strengthen Merkle-root trust through signed and externally anchored envelopes;
- define one canonical Neo4j vocabulary and identifier strategy;
- implement idempotent graph projection through an outbox;
- validate cross-domain scenarios against real MongoDB and Neo4j containers;
- generate reproducible evidence for the scientific manuscript.

## Protected materials

The registered INPI package and its corresponding integrity records must remain unchanged. Evolution occurs in the active development branch and does not rewrite protected release artifacts.
