# 2026-10-24: Participant is the seventh entity type the production ingestion route persists, behind the participant mount's clinical unit, deceased and consent template gates, and a record carrying civil identity is refused

Requirement RF029 AC3, AC4, AC6, AC7, RF005, RNF007. Dictionary ELM-0076..0087 (Participant), ParticipantIdentity. Issues #1318, #575, #1182, #1192, #1353.

## The question

`POST /api/ingestion/records` persisted `Dataset`, `WorkflowRun`, `OmicsQualification`, `Assay`, `OmicsRun` and `Specimen`. RF029 names Participant first, and `entityType: 'Participant'` answered 422 `INGESTION_TARGET_UNSUPPORTED`. Can Participant be a target? What does ingesting one do with the gates its master-data mount `/api/patients` holds, and with the civil identity `canonical.v1.participant` still carries?

v2's `Participant` (ELM-0076..0087) is pseudonymous. Civil identity is `ParticipantIdentity`, stored in "MongoDB protected identity boundary" (`docs/extracted-v2.0.0/dict-ENTIDADES.md` lines 96-97), and since #575 it is written only to `participantIdentities`, enciphered. `canonical.v1.participant` still carries the v1 identity fields (`patientName`, `birthDate`, `email`, `phone`, `identityDocument`, `recordNumber`). A quarantined record is stored as sent (`ingestionGateway.js`), so quarantining one of these records would write plaintext civil identity into `ingestionQuarantineRecords`.

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-24. The pattern, read off the six existing targets and their records: a target is an entity whose v2 authoritative store is MongoDB; it reuses the gates its master-data mount enforces, so ingesting is never a way around one; the route refuses rather than corrects (RF029 AC3), and refuses what it cannot place (RF029 AC4, OmicsRun's `INGESTION_STORE_UNSUPPORTED`); the server assigns the id; a lookup error is never a not-found verdict.

A. **`canonical.v1.participant` gains two optional properties**, both already `PatientModel.CANONICAL_FIELDS`: `clinicalUnitId`, the #1353 tenancy key, a Reference(Organization), and `consentTemplateId`, which `PatientModel.validate` requires. `required` stays `['participantId']`. The intake contract is unchanged: its `participant` is the participant schema with both properties set to `false`, so an intake that sends either inside `participant` still fails validation. The intake takes its organization from its top-level `organizationId` and its template from `consent`.

B. **A record carrying civil identity is refused, never quarantined.** A new optional target key, `identityFields`, which only Participant carries, is the union of `LEGACY_PATIENT_IDENTITY_FIELDS` and `PARTICIPANT_IDENTITY_ONLY_FIELDS` (`utils/legacyPatientIdentityFields.js`): `patientName`, `birthDate`, `identityDocument`, `email`, `phone`, the four `representative*` fields and `recordNumber`. A payload holding any of them as an own property, whatever its value (null and `''` included), is refused 422 `INGESTION_STORE_UNSUPPORTED` after the scope gate and before the idempotency replay (`productionIngestion.js` `assertNoIdentityFields`). The message names `ParticipantIdentity` and the fields, never their values. The refusal persists nothing: no quarantine record, no DataQualityAssessment, no idempotency entry. The route's one INGESTION_REFUSED row holds ids only.

C. **Its gates are the mount's, in the mount's order, on a model-valid copy** (`participantTarget.js` `validateParticipantReferences`):

   | gate | refusal | violation code |
   |---|---|---|
   | `clinicalUnitId` resolves in `organizations` by `organizationId` (`resolveClinicalUnitSnapshot`'s lookup by id) | 404 | `REFERENCE_NOT_FOUND` |
   | `isDeceased` is not `true`: the mount requires the representative's name, email, document and phone, identity fields B refuses, so no ingested record can satisfy it | 409 | `DECEASED_REPRESENTATIVE_REQUIRED` |
   | `consentTemplateId`, trimmed, is an ObjectId and resolves in `consent_templates` (`createPatient`'s template gate) | 404 | `REFERENCE_NOT_FOUND` |

   On success the mount's snapshot is written back: `clinicalUnit` is the organization's `officialName` trimmed, or null, and `unitAcronym` its `acronym` trimmed, or `PatientModel.fillAcronym` of the name. The trimmed `consentTemplateId` is written back. No lookup has a catch: a rejected lookup rethrows as a failure, never a not-found verdict an idempotency key would replay for good. The mount's fallback by unit name is not copied: the scope gate already requires a non-empty `clinicalUnitId`.

D. **Participant is the seventh target.** It lands where `/api/patients` writes, collection `patients`, id field `participantId`, through `PatientModel.validate` and `PatientModel.create`, against `canonical.v1.participant`. The model requires `sex` and `consentTemplateId`, and `create` defaults `status` to `PENDING_CONSENT`.
   - The id is the mount's 8-digit participantId (`generateUniqueParticipantId`), through `generateId`. The client's required `participantId` is ignored, as a body id is for every target.
   - `scopeField` and `organizationField` are both `clinicalUnitId`: the #1182 scope gate proves the value is in the caller's scope, a global caller also needs a non-empty one (else 403 `INGESTION_OUT_OF_SCOPE`), and the stamp writes the proven value.
   - `missingnessFields` is empty. Every non-required schema field is refused (B), required (`sex` and `consentTemplateId` by the model, `clinicalUnitId` by the scope gate), or defaulted by `PatientModel.create` (`isDeceased` false; true is refused by C). A declared MissingDataReason quarantines as `MISSING_REASON_FIELD_NOT_APPLICABLE`.
   - No `appendProjection`: the mount appends no graph event for a participant. `INGESTION_RECORD_PERSISTED` is still appended.
   - The stored document is `PatientModel.create`'s output plus the provenance and release fields every target gets. It gets no consent token, no notification and no `participantIdentities` record.
   - The other six targets are unchanged. `generateId` and `organizationField` are now shared by Specimen and Participant; `appendProjection` stays Specimen's alone, and `identityFields` is Participant's alone.

## Not decided here

- **Ingesting civil identity into `ParticipantIdentity`.** With it, the mount's required `patientName` and `birthDate` (`patient.service.js` `createPatient`), which ingestion does not apply, and its identifier-conflict and name+birthDate duplicate checks, which have nothing to match without identity.
- **A deceased participant's representative.**
- **`studyId`.** It is not in `canonical.v1.participant`, so a body that sends it quarantines.
- **Minting the e-consent token and its notification.**
- **An identity record for an ingested participant.**
- **A payload key outside the schema that is not on the identity list** still quarantines as sent, the behaviour every target has.
- **Consent, Telemetry and file ingestion, and Specimen storage allocation.**
