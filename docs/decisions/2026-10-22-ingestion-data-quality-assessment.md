# 2026-10-22: each ingested record gets a DataQualityAssessment, recorded and never gating

Requirement RNF011 C3, C5; RF029 AC6; CFG-004. Dictionary V2E-0270..0279. Issue #1318.

## The question

RNF011 C3 asks for a DataQualityAssessment of completeness, validity, consistency, uniqueness, timeliness and provenance. `POST /api/ingestion/records` accepted or quarantined a record and recorded no assessment, and nothing in `api/backend/src` modelled one. The dictionary rows V2E-0270..0279 name the ten fields, but their vocabulary cells give one value each, and no source names the metrics or their thresholds. What scope, statuses, metrics and thresholds does an ingested record's assessment use, and does it gate the record?

## Decided

`[inference]`, made by the #1318 slice on 2026-10-22, from the patterns named in each item:

1. **scopeType `ingested_record`.** V2E-0271's vocabulary cell lists only `dataset_release` (example `dataset_snapshot`), and the field is "Internal governed vocabulary when coded". The set is `dataset_release`, `dataset_snapshot`, `ingested_record`. The pattern is the repo extending a one-value vocabulary cell, as `2026-10-08-consent-history.md` item 6 and `2026-10-08-collection-governance.md` item 4 did. `scopeId` is a Reference: `<entityType>/<entityId>` for an accepted record, `IngestionQuarantineRecord/<id>` for a quarantined one.
2. **status `passed|failed`.** V2E-0278's cell lists only `passed`. The set reuses the run-status inference in `2026-10-07-configuration-validation-and-governance-registry.md` ("a run is recorded once it has executed, as `passed` or `failed`"). The status is `passed` when every result with a value meets its minimum; a result of null neither passes nor fails.
3. **Thresholds, versioned by assessmentVersion `1.0.0`.** Every dimension has `minimum: 1`. The metrics, in `api/backend/src/ingestion/dataQualityAssessment.js`:
   - **completeness**: the target schema's `required` fields present in the payload, over their count. undefined, null, `''` and `[]` are absent, the test `missingness.js` uses; an absent field is never filled in.
   - **provenance**: the four required envelope fields (`provenanceEnvelope.js`) present, over 4; a `retrievedAt` counts only as a valid date.
   - **validity**: 1 with no violation other than a provenance or model violation (contract, reference, code or missingness declaration), else 0.
   - **consistency**: 1 with no `ENTITY_VALIDATION_FAILED` from the model's `validate()`, else 0. That check covers required fields and formats as well as cross-field rules, so a missing required field also lowers completeness: a known overlap.
   - **uniqueness**: 0 when the target already stores a record with the same `sourceSystem` and `sourceRecordId`, else 1. With no `sourceRecordId` it is null, `notAssessed: 'no_source_record_id'`, never 0 (RNF011 C5).
   - **timeliness**: 1 when `retrievedAt` is no more than 5 minutes past `assessedAt`, the clock-skew tolerance of `services/telemetryReadingContract.js`, else 0. With no valid `retrievedAt` it is null, `notAssessed: 'no_retrieved_at'`.
4. **Recorded, not gating.** An assessment never blocks a record: the gateway alone accepts or quarantines it. RNF011 gates "antes da ativação ou promoção", which is release promotion, not ingestion. An accepted record's assessment is written in the record's transaction where one exists (RF029 AC6); a replay records none, and the loser of a same-key race without a transaction deletes its own.

## Not decided here

- **The DatasetSnapshot or release-scope assessment** (`dataset_release`, `dataset_snapshot`) that RNF011's promotion gate reads.
- **A Neo4j projection** of the assessment.
- **How a MissingDataReason enters completeness.** Completeness counts only the schema's `required` fields, which are never missingness fields, so a MissingDataReason does not change it today; how a reasoned absence is reported is #1318's missingness slice's call.
