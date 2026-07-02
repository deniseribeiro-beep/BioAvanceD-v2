# Orphanet Initial Seed Pipeline

## Objective

The initial ORPHA load follows a `pack-first + api-enrichment` strategy. Official local source files are normalized into a versioned artifact, validated before import, imported through idempotent upserts, and validated again against MongoDB.

The workflow is executed through Docker Compose and does not depend on host-specific paths, users, schedulers, or runtime workarounds.

## Versioned sources

The repository stores the source files in `orpha-data-raw/`:

- `Orphanet_Nomenclature_Pack_PT.zip`
- `Orphanet_Nomenclature_Pack_EN.zip`
- `Orphanet_Nomenclature_Pack_ES.zip`
- `ORPHA-SNOMEDCT_Mapping_File_production.xlsx`

The current remote builder must still be extended to consume the ES pack before the scientific baseline is frozen. The existence of the ES archive alone does not prove that it is represented in the normalized artifact.

## Semantic separation

- ORPHA represents rare diseases.
- ICD-10 and ICD-11 are external mappings.
- SNOMED CT comes from the complementary mapping file.
- OMIM is a controlled enrichment source.
- HPO terms belong to a separate phenotype pipeline.
- Biomarkers belong to a separate biomarker pipeline.
- Counts in `terminologies` must be filtered by semantic system.

## Artifact layout

```text
artifacts/orphanet-2025-07-initial-seed/
  manifest.json
  normalized/
    orphanet_entities.jsonl
    cids_projection.jsonl
    terminology_mappings.jsonl
    orphanet_classifications.jsonl
    terminologies_orpha.jsonl
  validation/
    source_counts.json
    normalized_counts.json
    checksums.json
    validation_report.json
```

## Docker Compose mounts

```text
orpha-data-raw/  -> /workspace/orpha-data-raw (read-only)
artifacts/       -> /workspace/artifacts
```

## Build

```bash
docker compose --env-file .env.docker -f docker-compose.yml run --rm --no-deps backend \
  npm run orphanet:build-initial-seed -- \
  --input /workspace/orpha-data-raw \
  --release 2025-07 \
  --out /workspace/artifacts/orphanet-2025-07-initial-seed
```

## Validate the artifact

```bash
docker compose --env-file .env.docker -f docker-compose.yml run --rm --no-deps backend \
  npm run orphanet:validate-initial-seed -- \
  --artifact /workspace/artifacts/orphanet-2025-07-initial-seed
```

The validation contract must cover source attribution, SHA-256 checksums, source and normalized counts, duplicate detection, required fields, terminology mappings, and semantic separation from HPO and biomarkers.

## Controlled OMIM enrichment

Provide the API key only through the runtime environment.

```bash
docker compose --env-file .env.docker -f docker-compose.yml run --rm --no-deps backend \
  npm run orphanet:enrich-omim -- \
  --artifact /workspace/artifacts/orphanet-2025-07-initial-seed \
  --release 2025-07 \
  --lang EN \
  --concurrency 3 \
  --delayMs 150 \
  --checkpoint
```

Run artifact validation again after enrichment.

## Import

Start the Compose stack and import through the backend service:

```bash
npm run compose:up

docker compose --env-file .env.docker -f docker-compose.yml exec backend \
  npm run orphanet:import-initial-seed -- \
  --artifact /workspace/artifacts/orphanet-2025-07-initial-seed \
  --batch 500 \
  --checkpoint
```

The importer uses idempotent upserts and records progress in the artifact validation directory.

## Validate the imported release

```bash
docker compose --env-file .env.docker -f docker-compose.yml exec backend \
  npm run orphanet:validate-imported-seed -- \
  --release 2025-07 \
  --artifact /workspace/artifacts/orphanet-2025-07-initial-seed
```

The post-import validator compares artifact counts with ORPHA records in `orphanet_diseases`, `cids`, `terminologies`, and `terminology_mappings`.

## Reproducibility evidence

Each scientific execution should retain:

- source release and checksums;
- code commit;
- container image and dependency versions;
- source and normalized counts;
- normalized output checksums;
- pre-import validation report;
- post-import validation report.
