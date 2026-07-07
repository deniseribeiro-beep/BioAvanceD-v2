# BioAvanceD Technical Inventory

> Status: documentação operacional.
> Este inventário descreve o branch atual e serve como referência canônica para rotas, serviços, Compose e validações.

## Scope

This inventory describes the repository structure without binding the project to a named host, public IP address, institution-specific path, or deployment branch.

## Freeze reference

- Snapshot date: `2026-07-06T12:02:35.9260071-03:00`
- Branch: `audit/intake-governance-i18n-orpha`
- SHA: `d978f59dfa24a64349242eb4516f8d5be5b1b40e`
- Historical copy: `docs/inventory/archive/freeze-2026-07-06-d978f59/`

## Architecture

- Frontend: `frontend/`, React and Vite.
- Backend: `api/backend/`, Node.js and Express.
- Document persistence: MongoDB.
- Graph persistence: Neo4j.
- Time-series persistence: InfluxDB.
- Cache and queues: Redis.
- Runtime definition: `compose.yml` with `compose.dev.yml`, `compose.test.yml`, and `compose.prod.yml`.
- Runtime configuration examples: `.env.docker.example`, `.env.test.example`, and `.env.production.example`.
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

The canonical Compose topology is environment-specific rather than a single flat list.

| Serviço | Dev | Test | Prod | Função |
|---|---|---|---|---|
| MongoDB | sim | sim | conforme implantação | documentos |
| Neo4j | sim | sim | conforme implantação | linhagem |
| Redis | sim | sim | conforme implantação | cache/filas |
| InfluxDB | sim | sim | conforme implantação | telemetria |
| Backend | sim | sim | sim | API |
| Frontend | sim | sim | sim | interface |
| Worker | sim | sim | sim, se necessário | processamento assíncrono |
| MQTT | opcional | sim | externo ou interno | telemetria |
| Mailpit | não | sim | não | SMTP de teste |
| TSA | conforme escopo | sim | sim | carimbo temporal |
| Witness | conforme escopo | sim | sim | ancoragem/verificação |
| Playwright runner | não | sim | não | E2E |

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
npm run compose:down
```

## ORPHA terminology status

The previous executable ORPHA seed and initial-import pipeline was removed from the active repository workflow.

Historical documentation is retained only for traceability in `docs/orphanet-artifact-pipeline.md`.

A future terminology acquisition, validation, versioning, and import workflow will be redesigned separately. No ORPHA population process is currently executed during application startup, Compose initialization, testing, or deployment.

## Current critical technical work

- complete PT, EN, ES, and SNOMED coverage in the ORPHA builder and validator;
- strengthen Merkle-root trust through signed and externally anchored envelopes;
- define one canonical Neo4j vocabulary and identifier strategy;
- implement idempotent graph projection through an outbox;
- validate cross-domain scenarios against real MongoDB and Neo4j containers;
- generate reproducible evidence for the scientific manuscript.

## Freeze-focused search terms

The updated inventory pass for Fase 0 must explicitly cover:

- `seed`
- `seeder`
- `bootstrap`
- `fixtures`
- `legacy`
- `aliases`
- `wrappers`
- duplicated configuration files

## Protected materials

The registered INPI package and its corresponding integrity records must remain unchanged. Evolution occurs in the active development branch and does not rewrite protected release artifacts.
