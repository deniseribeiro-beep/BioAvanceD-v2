# 2026-10-23: OmicsQualification is the third entity type the production ingestion route persists

Requirement RF029 AC4, AC6, AC7, AC10, RNF011 C3. Dictionary ELM-0337 `omicsQualificationId`, ELM-0338 `targetAssay`, ELM-0339 `qcRuleSetVersion`, ELM-0340 `qcMetrics`, ELM-0341 `qualificationDecision`, ELM-0342 `limitations`. Issue #1318.

## The question

`POST /api/ingestion/records` persisted only `Dataset` and `WorkflowRun`. RF029 asks for production ingestion of the canonical model, and each entity type the route accepts must land in its authoritative store (AC4), with its outbox event in the record's transaction (AC6), a MissingDataReason per absent field (AC7), a DataQualityAssessment (RNF011 C3) and one `INGESTION_*` audit row (AC10). Which entity type comes next, and in which collection does it land?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-23. The pattern: the two existing targets are entities whose v2 authoritative persistence is MongoDB, and whose model and canonical schema already mirror each other field for field, so a target is one frozen entry in `ingestionTargets.js` and the generic path in `productionIngestion.js` does the rest.

1. **OmicsQualification is the third target.** It is one v2 entity, and `dict-ENTIDADES.md` gives MongoDB as its authoritative persistence. Its model (`OmicsQualification.js`), its schema `canonical.v1.omicsQualification` and its collection already exist and mirror each other.
2. **It lands where `/api/omics-qualifications` writes:** collection `omicsQualifications`, id field `omicsQualificationId`, with a server uuid as for the other two targets.
3. **Its one missingness field is `limitations`** (ELM-0342, 0..1): the schema's fields outside `required`, less the id field. An absent `limitations` is stored as `null`, gets a MissingDataReason, and a declared reason on a present one quarantines. Completeness is over the four required fields.
4. **`productionIngestion.js` is unchanged.** The insert, the outbox append, the MissingDataReason rows, the assessment and the no-transaction loser cleanup (document, event, MissingDataReason rows, assessment) are all keyed off the target, so the new target is in step with them; a concurrent-loser unit case on OmicsQualification proves the cleanup.

Not chosen as the third target:

- **OmicsRun.** The code models one entity, but v2 splits it into five (GenomicsRun, TranscriptomicsRun, ProteomicsRun, MetabolomicsRun, MicrobiomeRun), and `dict-ENTIDADES.md` gives three of them Object Storage as the authoritative store. A MongoDB placement for every modality would contradict RF029 AC4.
- **Specimen, Participant and Consent** bring consent and PII gates (RF029 AC2, RNF007).
- **Telemetry** needs InfluxDB (AC4).

## Not decided here

- **OmicsRun and the five v2 omics-run entities**, with their mixed MongoDB and Object Storage stores.
- **`targetAssay` as a CodeableConcept checked against active codes.** v2 types ELM-0338 as CodeableConcept; the target keeps the model's non-empty string, not resolved against `assays` and not checked as a code (RF029 AC3). The route accepts no client `references`.
- **Specimen, Participant and Consent ingestion.**
- **Telemetry ingestion.**
