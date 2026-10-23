# 2026-10-23: a quarantined ingestion record keeps the client's `missingDataReasons` as received

Requirement RF029 AC3, AC7, RNF011 C6. Issue #1318.

## The question

`POST /api/ingestion/records` takes a top-level `missingDataReasons` declaration beside `payload` ([2026-10-22](2026-10-22-ingestion-missing-data-reasons.md), decision 1). An accepted record gets MissingDataReason rows from it, but the gateway stored only `payload`, `violations` and `provenance` on an IngestionQuarantineRecord, so a quarantined record lost the declaration and its review (RF029 AC3) could no longer tell why a field was absent. Does the quarantine record keep the declaration, and in what form?

## Decided

`[inference]`, from the repo's code, by the coordinator for #1318, on 2026-10-23:

1. **The quarantine record keeps the declaration beside `payload`**, as the field `missingDataReasons`. The quarantine record already keeps the client's input as received (`api/backend/src/ingestion/quarantine.js`: "never corrects or drops it silently", with its stored `payload` and `provenance`), and the declaration already travels beside the payload.
2. **It is stored as received, unvalidated.** A malformed declaration (a non-array, an entry with extra keys, an unknown reasonCode) is exactly what can cause the quarantine, so the record keeps it unchanged (RF029 AC3, RNF011 C6, no silent correction). `IngestionQuarantineRecordModel.validate` never refuses on it.
3. **It is `null` when the body sent none**, the same as `payload`. A caller that passes no declaration, such as the test-support route, stores `null`.

A replay writes no new record, so a retry with a different declaration leaves the first record's declaration as it was.

## Not decided here

- **Whether a later release of the quarantined record writes MissingDataReason rows from the stored declaration** (`resolveQuarantineRecord`, `reprocessed`). No reprocess flow exists yet.
