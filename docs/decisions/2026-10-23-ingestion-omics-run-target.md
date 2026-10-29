# 2026-10-23: OmicsRun is the fifth entity type the production ingestion route persists, for its MongoDB modalities only

Requirement RF029 AC3, AC4, AC6, AC7, AC10, RNF011 C3. Dictionary ELM-0343..0352 (OmicsRun, "Dados ômicos e imagens"). Issue #1318.

## The question

`POST /api/ingestion/records` persisted `Dataset`, `WorkflowRun`, `OmicsQualification` and `Assay`. RF029 asks for further entity types. The OmicsQualification and Assay records both rejected OmicsRun: the code models one entity with a `modality` field, but v2 splits it into five, and three of those are stored in Object Storage. Can OmicsRun be a target, and what does ingesting one do for each modality?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-23. The pattern, read off the four existing targets and their records: a target is an entity whose v2 authoritative store is MongoDB, it reuses what its master-data mount enforces (the `app.js` mounts), and the route refuses rather than corrects (RF029 AC3). The earlier records rejected OmicsRun only because a MongoDB placement for *every* modality would contradict RF029 AC4. Accepting only the two MongoDB modalities removes that objection.

1. **OmicsRun is the fifth target, by modality.** `docs/extracted-v2.0.0/dict-ENTIDADES.md` gives each v2 omics-run entity its authoritative store:

   | modality | v2 entity | store | dict-ENTIDADES line |
   |---|---|---|---|
   | `genomics` | GenomicsRun | MongoDB | 66 |
   | `microbiome` | MicrobiomeRun | MongoDB | 84 |
   | `metabolomics` | MetabolomicsRun | Object Storage | 83 |
   | `proteomics` | ProteomicsRun | Object Storage | 103 |
   | `transcriptomics` | TranscriptomicsRun | Object Storage | 146 |

   A `genomics` or `microbiome` run lands where `/api/omics-runs` writes: collection `omicsRuns`, id field `omicsRunId`, with a server uuid as for the other targets. Its model (`OmicsRun.js`) and its schema `canonical.v1.omicsRun` already exist and mirror each other. The mount has no reference check and no organization scope, so the target carries neither `validateReferences` nor `scopeField`.
2. **Its missingness fields are `referenceAssembly`, `mixsChecklist` and `fileLinks`:** the schema's fields outside `required` (`modality`), less the id field. `OmicsRunModel.create` stores the first two as `null` and `fileLinks` as `[]`, each read as absent, so each gets a MissingDataReason.
3. **A `transcriptomics`, `proteomics` or `metabolomics` run is refused 422 `INGESTION_STORE_UNSUPPORTED`** (RF029 AC4), audited as one `INGESTION_REFUSED` warning row that names both release ids. Nothing is written: no document, quarantine record, idempotency key, MissingDataReason or assessment. The refusal comes before the idempotency replay. It is a new optional target key, `otherStore` (`field: 'modality'`, the three values, `store: 'objectStorage'`), which only OmicsRun carries, checked in `productionIngestion.js` by `assertStoredHere`.
4. **Any other modality goes on to the model and schema.** An absent, non-string or unknown `modality` is not refused; it quarantines, as for any record that fails its schema (RF029 AC3).
5. **The other four targets are unchanged.** The insert, outbox append, MissingDataReason rows, assessment and the no-transaction loser cleanup are all keyed off the target.

## Not decided here

- **Ingestion of the three Object Storage modalities.** They need an Object Storage path, which this route does not have.
- **The five v2 omics-run entities as separate entities.** The target keeps the code's single modality-discriminated model.
- **`fileLinks[].fileId` resolution.** A `fileId` is not resolved against the file store; the master mount does not resolve it either.
- **Specimen, Participant and Consent ingestion**, with their consent and PII gates (RF029 AC2, RNF007).
- **Telemetry ingestion**, which needs InfluxDB (AC4).
