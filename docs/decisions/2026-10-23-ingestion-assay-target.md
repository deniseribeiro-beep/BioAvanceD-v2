# 2026-10-23: Assay is the fourth entity type the production ingestion route persists

Requirement RF029 AC3, AC4, AC6, AC7, AC10, RF019 AC3, RNF011 C3. Dictionary ELM-0286..0297 (Assay, "Ensaios e experimentos"). Issues #1318, #1182, #1219.

## The question

`POST /api/ingestion/records` persisted `Dataset`, `WorkflowRun` and `OmicsQualification`. Which entity type comes next, and since its master-data mount `/api/assays` enforces two gates the other three targets have none of, a reference check and an organization scope, what does ingesting one do with them?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-23. The pattern: each target reuses what its master-data mount enforces (the `app.js` mounts), and the route quarantines rather than corrects (RF029 AC3, the `productionIngestion.js` header). Ingesting an Assay is never a way around a gate its mount holds.

1. **Assay is the fourth target.** `dict-ENTIDADES.md` gives MongoDB as its authoritative persistence. It is the one remaining canonical schema whose entity has no consent or PII gate and no non-MongoDB store. Its model (`Assay.js`), its schema `canonical.v1.assay` and its collection `assays` already exist and mirror each other. It lands where `/api/assays` writes, id field `assayId`, with a server uuid as for the other targets.
2. **Its missingness fields are `omicsDomain`, `assayBatchId`, `controls`, `reagentLotIds` and `equipmentIds`:** the schema's fields outside `required`, less the id field. `AssayModel.create` stores the first two as `null` and the three arrays as `[]`, each read as absent, so each gets a MissingDataReason.
3. **It runs the master mount's own reference check** (`assayReferenceValidator.js`) on a model-valid payload, before the gateway. An unresolved specimen, protocol, operator, laboratory, reagent lot or equipment (a 404 there) quarantines as `REFERENCE_NOT_FOUND`; a quarantined specimen (a 409, RF019 AC3) quarantines as `REFERENCE_NOT_USABLE`. The quarantine record holds the payload as sent. Any other error from the check is a failure, answered 500 and audited as one. A resolved check runs on a copy, and the copy, with the canonical `specimenIds` the check writes back (#1219), is what is stored, as the mount stores it.
4. **An Assay outside the caller's organization scope refuses 403 `INGESTION_OUT_OF_SCOPE`** (#1182), audited `INGESTION_REFUSED`. The record is written only on positive evidence: a global scope, or an organization scope whose `organizationIds` include the payload's `laboratoryId` exactly. No scope, a `none` or `unassigned` scope, or an absent or out-of-scope `laboratoryId` refuses. The mount restamps an absent `laboratoryId` with the caller's organization; ingestion does not, since it refuses rather than correct (RF029 AC3). The check comes before the idempotency replay.
5. **The other three targets are unchanged.** The reference check and the scope gate are optional keys of a target, `validateReferences` and `scopeField`, which only Assay carries.

Not chosen as the fourth target:

- **Specimen, Participant, Consent, intake and clinicalData** bring consent and PII gates (RF029 AC2, RNF007).
- **OmicsRun** splits into five v2 entities, three with Object Storage as their authoritative store.
- **Telemetry** needs InfluxDB, and **file** is a binary in Object Storage (AC4).

## Not decided here

- **`studyId` resolution.** The Assay's `studyId` is not resolved against `studies`; the master mount does not resolve it either.
- **The other canonical schemas** named above, with their gates and stores.
