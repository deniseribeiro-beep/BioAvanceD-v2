# 2026-10-24: Consent is the eighth entity type the production ingestion route persists, behind the consent mount's participant, template, validity and responses gates, accepting only a granted, dated consent for a participant with none in force, and a record carrying civil identity or a signer's name or image is refused

Requirement RF029 AC2, AC3, AC4, AC6, AC7, RF010 AC1, AC3, AC4, AC5, RF023 AC3. Dictionary ELM-0088..0113 (Consent), ELM-0093, V2E-0113..0131 (ConsentPermission, ConsentDecisionEvent). Issues #1318, #575, #827, #1313.

## The question

`POST /api/ingestion/records` persisted `Dataset`, `WorkflowRun`, `OmicsQualification`, `Assay`, `OmicsRun`, `Specimen` and `Participant`. RF029 names Consent second, and `entityType: 'Consent'` answered 422 `INGESTION_TARGET_UNSUPPORTED`. Can Consent be a target? What does ingesting one do with the gates its master-data mount (`consent.service.js` `createPatientConsent`) holds, with what the mount writes beside the consent document, and with the signer's name and image the document can carry?

v2's `Consent` is stored in MongoDB with a Neo4j projection through the outbox (`docs/extracted-v2.0.0/dict-ENTIDADES.md` line 31). An ingested consent becomes an ACTIVE consent, and an ACTIVE consent is what the Specimen target's consent gate trusts (RF029 AC2), so a consent accepted on weak evidence would open the specimen path behind it.

## Decided

`[inference]`, from the specification and the repo's pattern, by the coordinator for #1318, on 2026-10-24. Every decision below is an inference, not a citation. The pattern, read off the seven existing targets and their records: a target is an entity whose v2 authoritative store is MongoDB; it reuses the gates its master-data mount enforces, so ingesting is never a way around one; the route refuses rather than corrects (RF029 AC3), and refuses what it cannot do; the server assigns the id; a gate accepts only on positive evidence (Specimen's consent gate); a lookup error is never a not-found verdict.

A. **`canonical.v1.consent` gains two optional properties**, in the mount's `patientConsentSchema` shape, both required by `PatientConsentModel.validate`: `participantId` (a non-empty string) and `responses` (an object of booleans). No `required` is added, because the intake shares the schema. The intake contract is unchanged: its `consent` is the consent schema with both properties set to `false`, as its `participant` already is for `clinicalUnitId` and `consentTemplateId`.

B. **A record carrying civil identity or a signer's name or image is refused, never quarantined.** Consent's `identityFields` are Participant's (`LEGACY_PATIENT_IDENTITY_FIELDS` and `PARTICIPANT_IDENTITY_ONLY_FIELDS`) plus `signatureName`, `signatureImageBase64` and `signatureBase64` (the mount's alias for the image). `assertNoIdentityFields` is unchanged: a payload holding any of them as an own property, whatever its value, is refused 422 `INGESTION_STORE_UNSUPPORTED` after the scope gate and before the idempotency replay, naming the fields and never their values, and persisting nothing. A quarantine stores a record as sent, so this is what keeps a signer's name or image out of `ingestionQuarantineRecords`.

C. **Its gates, on a model-valid copy** (`consentTarget.js` `validateConsentReferences`), the mount's first and in its order. A 404 or 409 with no code of its own quarantines as `REFERENCE_NOT_FOUND` or `REFERENCE_NOT_USABLE`.

   | gate | refusal | violation code |
   |---|---|---|
   | `participantId` is 8 digits and resolves in `patients` (`validateParticipantId`'s check and lookup, without its catch) | 404 | `REFERENCE_NOT_FOUND` |
   | `consentTemplateId`, trimmed, is an ObjectId and resolves in `consent_templates` | 404 | `REFERENCE_NOT_FOUND` |
   | the template is `active` | 409 | `REFERENCE_NOT_USABLE` |
   | now is within the template's `validFrom`/`validTo`, an unparseable bound ignored, as the mount reads them | 409 | `REFERENCE_NOT_USABLE` |
   | `responses` answer every permission with a boolean, accept every `required` one, and hold no key outside the template (`validateResponsesAgainstTemplate`'s three checks and messages, inlined) | 409 | `CONSENT_RESPONSES_INVALID` |
   | `consentGranted` is `true`; absent or false refuses, because only positive evidence becomes an ACTIVE consent | 409 | `CONSENT_NOT_GRANTED` |
   | `consentAcceptedAt` is an ISO 8601 date-time with a zone (`YYYY-MM-DDThh:mm[:ss[.f]]` then `Z` or `±hh:mm`); a looser string such as `0`, `2026` or a date without a time or zone is refused, never reinterpreted by the Date parser (RF029 AC3) | 409 | `CONSENT_DECISION_TIME_INVALID` |
   | `consentAcceptedAt` parses to a time not after now and not before the template's `validFrom` (a time after `validTo` is after now); absent refuses | 409 | `CONSENT_DECISION_TIME_INVALID` |
   | no consent of the participant has status `ACTIVE`, `VALID` or `GRANTED` (the statuses Specimen's gate trusts) | 409 | `CONSENT_ALREADY_ACTIVE` |

   `consentAcceptedAt` is the decision time (ELM-0093). The mount stamps now because it records a live signing; an ingested record is a past one, and an absence never becomes a value (RF029 AC7). *(Superseded by `2026-10-25-ingestion-consent-supersession.md`.)* The mount supersedes a consent in force; supersession rewrites another consent's state, which the no-transaction loser path cannot undo, so ingestion refuses. No lookup has a catch: a rejected lookup rethrows as a failure, never a verdict an idempotency key would replay for good. On success the mount's create input is written back: the trimmed `consentTemplateId`, `signedAt` = `consentAcceptedAt`, `consentVersion` = the template's `version` as a string or null, `consentModel` = the template's `consentModel` or null.

D. **Consent is the eighth target.** It lands where the mount writes, collection `patientConsents`, id field `consentId`, through `PatientConsentModel.validate` and `create`, against `canonical.v1.consent`. `create` sets `status` ACTIVE and drops `consentGranted` and `consentAcceptedAt`, whose value `signedAt` carries.
   - The id is a server uuid, the default, which is the mount's `randomUUID`. No `generateId`.
   - No `scopeField` or `organizationField`: the mount holds no organization gate.
   - `missingnessFields` is empty: `participantId`, `consentTemplateId` and `responses` are required by the model, `consentGranted` and `consentAcceptedAt` by the gates. A declared MissingDataReason quarantines as `MISSING_REASON_FIELD_NOT_APPLICABLE`.
   - **Before the transaction**, a new optional target key, `prepareDocument`, called after the provenance and release stamps: Consent's reads the template again (missing now is a plain failure), stores the decision's evidence through `consentEvidence.storeConsentEvidence` (#827) with `decisionDateTime` = `signedAt`, signer role participant and no signature hash or origin, stamps `evidenceDocumentUri`, `evidenceHash`, `evidenceMimeType` and `evidenceEncryption` on the document, and answers one `ConsentPermission` row per response (`ConsentPermissionModel.fromAnswers`). A keyless deployment fails closed here, as on the mount.

E. **What is written in the insert's transaction** (RF029 AC6, RF023 AC3), through Consent's `appendProjection`, which receives what `prepareDocument` answered:
   - the consent document and `INGESTION_RECORD_PERSISTED`, as for every target;
   - the permission rows in `consentPermissions`, when there are any (RF010 AC3);
   - one `accepted` ConsentDecisionEvent and the consent's recomputed derived state (`consentHistory.recordAcceptance`, RF010 AC4/AC5), under the staff-portal mount's actor: channel `staff_portal`, signer role `participant`, signer id the participantId, authentication level `session`. The ingestion route's callers, roles 3 and 4, are the staff portal's; a channel value of its own would be a vocabulary change not decided here;
   - one `CONSENT_UPSERTED` outbox event keyed by the inserted `_id`, source `ingestion-gateway`, as the mount appends it;
   - the DataQualityAssessment, as for every target. No MissingDataReason row.

   Without a transaction, a request that loses the idempotency race removes its document, its events and, through a new optional target key `removeProjection`, its permission and decision rows. The other seven targets carry neither new key and behave as before.

## Not decided here

- **Supersession of a consent in force by an ingested one**: decided in `2026-10-25-ingestion-consent-supersession.md`. Revocation by ingestion stays open.
- **The consent's purpose.**
- **`studyId`.** It is not in `canonical.v1.consent`, so a body that sends it quarantines.
- **`signatureMimeType`, `signatureHash`, `ipAddress` and `userAgent`.** They are outside the schema and not identity, so a body that sends one quarantines as sent.
- **An organization scope gate.** The mount has none.
- **Two concurrent ingestions for one participant** both passing the no-consent-in-force gate before either writes.
- **An evidence file left behind** when the insert fails or the idempotency race is lost, as the mount leaves one on a failed insert.
- **Telemetry, file and binary targets, and Specimen storage allocation.**
