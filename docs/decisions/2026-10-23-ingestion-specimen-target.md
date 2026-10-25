# 2026-10-23: Specimen is the sixth entity type the production ingestion route persists, behind the sample mount's participant, consent, parent, site and barcode gates

Requirement RF029 AC2, AC3, AC6, AC7, AC10, RF023 AC3, RNF011 C3. Dictionary ELM-0116 (barcode), ELM-0120 (parentSpecimenIds), ELM-0128 (collectionSite). Issues #1318, #1182, #1192, #1313, #1368, #1378.

## The question

`POST /api/ingestion/records` persisted `Dataset`, `WorkflowRun`, `OmicsQualification`, `Assay` and `OmicsRun`. RF029 names Specimen first after Participant and Consent. The earlier records passed over it because it brings consent and reference gates (RF029 AC2). Can Specimen be a target, and what does ingesting one do with the gates its master-data mount `/api/samples` holds?

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-23. The pattern, read off the five existing targets and their records: a target is an entity whose v2 authoritative store is MongoDB; it reuses what its master-data mount enforces, so ingesting is never a way around a gate the mount holds; the route refuses rather than corrects (RF029 AC3); the server assigns the id. Specimen is stored in MongoDB (`docs/extracted-v2.0.0/dict-ENTIDADES.md` line 130), with a Neo4j projection through the transactional outbox. This slice reuses the mount's gates and makes the consent gate fail closed.

1. **Specimen is the sixth target.** It lands where `/api/samples` writes, collection `samples`, id field `specimenId`, through `SampleModel.validate` and `SampleModel.create`, against `canonical.v1.specimen`.
2. **Its gates are the mount's, in order, on a model-valid copy** (`specimenTarget.js` `validateSpecimenReferences`):

   | gate | refusal | violation code |
   |---|---|---|
   | `participantId` is 8 digits and resolves in `patients` (`validateParticipantId`) | 404 | `REFERENCE_NOT_FOUND` |
   | the participant has a consent with status `ACTIVE`, `VALID` or `GRANTED` (RegisterSample.js's query) | 409 | `CONSENT_NOT_ACTIVE` |
   | a non-empty `collectionSite` resolves in `organizations` by `organizationId` | 404 | `REFERENCE_NOT_FOUND` |
   | each `parentSpecimenIds` entry exists in `samples` | 404 | `REFERENCE_NOT_FOUND` |
   | each parent belongs to the same participant | 409 | `REFERENCE_NOT_USABLE` |
   | no parent is terminal (`SampleModel.isTerminalSpecimen`) | 409 | `REFERENCE_NOT_USABLE` |
   | a `barcode` once the window is closed (#1378) | 409 | `LEGACY_BARCODE_WRITE_REFUSED` |
   | a `barcode` another sample already holds, while the window is open | 409 | `DUPLICATE_BARCODE` |

   Each one quarantines the record as sent. A check that names its own violation code sets `violationCode` on its error, and `checkReferences` uses that code instead of the status code's. The duplicate-barcode check means the unique `barcode` index never turns a duplicate into a 500.
3. **The consent gate fails closed.** Ingestion always applies it, unlike the mount's permissive mode (RF029 AC2), and accepts only on positive evidence. A missing consent, a revoked one or one with no status never accepts.
4. **The id is the mount's 7-digit specimenId**, as a string (`generateUniqueSpecimenId`), not a uuid, because every reader of `samples` expects that format. It is a new optional target key, `generateId`. The client's required `specimenId` is ignored, as a body id is for every target.
5. **`organizationId` is stamped by the server from `collectionSite`** (#1192), through a new optional target key, `organizationField`. `scopeField` is `collectionSite`, so the #1182 scope gate has already proved that value is in the caller's scope. A target that stamps tenancy needs the value even from a global caller: an absent `collectionSite` refuses 403 `INGESTION_OUT_OF_SCOPE` before the replay, and the mount's restamp to the caller's organization is not copied. `canonical.v1.specimen` has no `organizationId`, so a body that sends one quarantines.
6. **SPECIMEN_UPSERTED and one LINEAGE_REGISTERED per parent are appended in the sample's transaction** (#1313, RF023 AC3), after `INGESTION_RECORD_PERSISTED`, through a new optional target key, `appendProjection`. As in the mount, each event is keyed by the inserted `_id`, and each lineage event carries its parent's `_id`. Without a transaction, a concurrent loser deletes these events too, with its document.
7. **Its missingness fields are `barcode`, `linkedProject`, `parentSpecimenIds`, `merkleRoot` and `sprec`:** the schema's non-required fields that `SampleModel.create` can store absent (null, undefined or `[]`), so each gets a MissingDataReason. The others are excluded. The model requires `sampleType`, `sampleOrigin`, `extractionProtocol`, `quantity` and `registeredAt`. It defaults `unit` (`µL`) and `specimenStatus` (`available`). The scope gate requires `collectionSite`.
8. **The specimen is stored unallocated**, with no box or position, as `import.service.js` `importSamples` stores one.
9. **The other five targets are unchanged.** `generateId`, `organizationField` and `appendProjection` are optional keys that only Specimen carries.

## Not decided here

- **Storage allocation and the LabelIdentifier** are decided in `2026-10-25-ingestion-specimen-storage-and-label.md`.
- **Consent purpose (finalidade).** The gate asks for an active consent, not one whose purpose covers the use.
- **RCS/SPREC evaluation of `sprec`.** The value is stored as given; nothing evaluates it.
- **The `studyId`, `protocolId` and `collectionId` gates** the mount runs. These fields are not in `canonical.v1.specimen`, so a body that sends one quarantines.
- **Participant, Consent, Telemetry and file ingestion.**
