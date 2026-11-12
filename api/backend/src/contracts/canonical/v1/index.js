const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({ allErrors: true, strict: true, removeAdditional: false });
addFormats(ajv);

const participantSchema = {
  $id: 'canonical.v1.participant',
  type: 'object',
  additionalProperties: false,
  properties: {
    participantId: { type: 'string', minLength: 1 },
    patientName: { type: 'string' },
    birthDate: { type: 'string', format: 'date' },
    sex: { type: 'string' },
    email: { type: 'string', format: 'email' },
    phone: { type: 'string' },
    identityDocument: { type: 'string' },
    recordNumber: { type: 'string' },
    isDeceased: { type: 'boolean' },
    // The participant's clinical unit, a Reference(Organization) and its tenancy key (#1353).
    clinicalUnitId: { type: 'string', minLength: 1 },
    // The consent template PatientModel.validate requires (#1318).
    consentTemplateId: { type: 'string', minLength: 1 }
  },
  required: ['participantId']
};

const specimenSchema = {
  $id: 'canonical.v1.specimen',
  type: 'object',
  additionalProperties: false,
  properties: {
    specimenId: { type: 'string', minLength: 1 },
    participantId: { type: 'string', minLength: 1 },
    sampleType: { type: 'string' },
    sampleOrigin: { type: 'string' },
    extractionProtocol: { type: 'string' },
    barcode: { type: 'string' },
    quantity: { type: 'number' },
    unit: { type: 'string' },
    registeredAt: { type: 'string' },
    specimenStatus: { type: 'string' },
    linkedProject: { type: 'string' },
    // ELM-0128: the collection site, an Organization reference. The intake
    // stamps the caller's resolved organization here (#1355).
    collectionSite: { type: 'string' },
    // dict-02 ELM-0120: the specimens this one derives from (#1371).
    parentSpecimenIds: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
    merkleRoot: { type: 'string' },
    sprec: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string' },
        version: { type: 'string' },
        matrixType: { type: 'string' },
        sampleType: { type: 'string' },
        primaryContainer: { type: 'string' },
        preCentrifugation: { type: 'string' },
        centrifugation: { type: 'string' },
        secondCentrifugation: { type: 'string' },
        postCentrifugationDelay: { type: 'string' },
        collectionType: { type: 'string' },
        warmIschemia: { type: 'string' },
        coldIschemia: { type: 'string' },
        fixationType: { type: 'string' },
        fixationTime: { type: 'string' },
        longTermStorage: { type: 'string' }
      },
      required: ['code', 'version']
    }
  },
  required: ['specimenId', 'participantId']
};

const consentSchema = {
  $id: 'canonical.v1.consent',
  type: 'object',
  additionalProperties: false,
  properties: {
    consentTemplateId: { type: 'string' },
    consentGranted: { type: 'boolean' },
    consentAcceptedAt: { type: 'string' },
    // The participant and the answers PatientConsentModel.validate requires,
    // in the consent mount's patientConsentSchema shape (#1318).
    participantId: { type: 'string', minLength: 1 },
    responses: { type: 'object', additionalProperties: { type: 'boolean' } },
    // The one consent in force an ingested consent supersedes (#1318).
    supersedesConsentId: { type: 'string', minLength: 1 }
  }
};

// RF029 slice 2/6 (#670): extracted out of intakeSchema's own inline
// `clinical` property so it's independently referenceable (canonical.v1.
// clinicalData) by the ingestion gateway (#669), instead of only existing
// nested inside one intake-wizard payload. `participantId` is new here —
// optional, since intakeWizard.js's own payload shape never sets it
// (the participant is already known from the intake's own top-level
// `participant` field) — but a standalone clinicalData ingestion call
// needs it to run assertReferencesExist against a real Participant.
// additionalProperties: false + no other shape change, so this is a
// behavior-preserving refactor for the existing intake-wizard path.
const clinicalDataSchema = {
  $id: 'canonical.v1.clinicalData',
  type: 'object',
  additionalProperties: false,
  properties: {
    participantId: { type: 'string', minLength: 1 },
    charlsonConditions: { type: 'array' },
    bloodPressure: { type: 'string' },
    clinicalObservations: { type: 'string' },
    diseasePhenotypes: { type: 'array' },
    diseaseBiomarkers: { type: 'array' },
    biomarkersValues: { type: 'object' },
    diagnosisDefinition: { type: 'string' },
    // #708 (RF005 clinical-UI slice, tracker #707): manual-entry allergen
    // list -- dict-02 ELM-0246..0248's AllergyIntolerance (allergenCoding
    // DCB/SNOMED-coded, reaction free text), same "no picker exists,
    // accept manual entry" precedent the wizard's diagnosis codes already
    // use (intakeWizard.js's recordClinicalEntities doc comment).
    allergies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          allergenName: { type: 'string' },
          allergenCode: { type: 'string' },
          reaction: { type: 'string' }
        }
      }
    },
    // #709 (RF005 clinical-UI slice, tracker #707): manual-entry family
    // history list -- dict-02 ELM-0249..0251's FamilyHistory (relationship
    // CodeableConcept with no dict-specified coding system, familyCondition
    // ORPHA|ICD-11|MONDO-coded but coded here against ORPHA only, same
    // "code what's actually searchable in this wizard" precedent as
    // ICD-10-only for diagnosisCidCode).
    familyHistories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          relationship: { type: 'string' },
          conditionName: { type: 'string' },
          orphaCode: { type: 'string' },
          onset: { type: 'string' }
        }
      }
    },
    // #710 (RF005 clinical-UI slice, tracker #707): manual-entry procedure
    // list -- dict-02 ELM-0242..0245's Procedure (procedureCoding
    // SNOMED/institutional-terminology-coded, performed a required date,
    // bodySite an optional free-text site). No SNOMED importer exists in
    // this repo, so procedureCoding is coded against a local/institutional
    // system URI (dict-02 explicitly allows "terminologia institucional"
    // as an alternative to SNOMED) rather than left uncoded.
    procedures: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          procedureName: { type: 'string' },
          procedureCode: { type: 'string' },
          performed: { type: 'string' },
          bodySite: { type: 'string' }
        }
      }
    },
    // #711 (RF005 clinical-UI slice, tracker #707): manual-entry
    // lab-result/observation list -- dict-02 ELM-0219..0232's
    // ClinicalObservation entity (observationCoding LOINC-coded,
    // value/unit preserved as originally entered, effectiveDateTime
    // required). Named `observationRecords`, not `clinicalObservations`
    // -- that key already exists just below as the free-text clinical
    // notes textarea (`formData.clinicalObservations`), a distinct,
    // unrelated field that predates this entity's wiring. This repo has
    // a real LOINC reference importer (reference-data/reference-imports/
    // sources/loinc.js), so observationCoding is coded against the real
    // 'http://loinc.org' systemUri, not a locally-invented one.
    observationRecords: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          testName: { type: 'string' },
          loincCode: { type: 'string' },
          value: { type: 'string' },
          unit: { type: 'string' },
          effectiveDate: { type: 'string' }
        }
      }
    },
    // #712 (RF005 clinical-UI slice, tracker #707): manual-entry
    // longitudinal-outcome list -- dict-02 ELM-0252..0254's ClinicalOutcome
    // entity (outcomeType a CodeableConcept over the dictionary's 7
    // categories -- progressão/remissão/recidiva/resposta/toxicidade/
    // hospitalização/óbito, mapped to English slugs here; outcomeDate
    // required). Unlike the other 5 clinical-UI slices, no UI existed for
    // this entity before #712 -- this schema addition is new, not a
    // mapping of an already-collected field.
    clinicalOutcomes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          outcomeType: { type: 'string' },
          outcomeDate: { type: 'string' }
        }
      }
    },
    pharmacologyData: {
      type: 'object',
      additionalProperties: false,
      properties: {
        treatmentStatus: { type: 'string' },
        medicationName: { type: 'string' },
        atcCode: { type: 'string' },
        atcClass: { type: 'string' },
        lastDoseDate: { type: 'string' },
        washoutStartDate: { type: 'string' },
        washoutEndDate: { type: 'string' }
      }
    }
  }
};

// RF029 slice 3/6 (#671): TelemetryReading per dict-02_DICIONARIO.md
// ELM-0357..ELM-0365. Required fields are the dictionary's 1..1 ones that a
// caller can also actually supply explicitly -- notably `value`/`unit`/
// `metricType` are required even though RF009's real POST /api/iot/telemetry
// body today only sends {sensorId, temperature, timestamp} (implicit
// Celsius, implicit "temperature" metric): the canonical contract
// deliberately does not accept that implicit legacy shape, same
// enforce-the-explicit-cardinality spirit as AC#2's alias/unknown-field
// rejection. `equipmentId` stays optional -- derivable server-side via
// SensorMetadata.device (same "optional, joinable" call clinicalDataSchema
// made for participantId) -- even though a real Device model/collection
// exists (models/Device.schema.js) to reference-check it against when
// supplied. `thresholdProfileId` also stays optional, same "optional,
// joinable" precedent as equipmentId above: #678 aligned RF009's
// temperaturePolicies collection to dict-02's ThresholdProfile shape
// (metricType/ruleVersion/effectivePeriod/minimumDuration added,
// models/TemperaturePolicy.schema.js), so the entity now genuinely
// exists -- but reference-validating a supplied thresholdProfileId
// against it is a separate ingestion-pipeline concern this slice didn't
// take on, not still blocked on the entity's absence.
const telemetrySchema = {
  $id: 'canonical.v1.telemetry',
  type: 'object',
  additionalProperties: false,
  properties: {
    sensorId: { type: 'string', minLength: 1 },
    equipmentId: { type: 'string' },
    metricType: { type: 'string' },
    timestamp: { type: 'string' },
    value: { type: 'number' },
    unit: { type: 'string' },
    measurementQuality: { type: 'string' },
    calibrationStatus: { type: 'string' },
    thresholdProfileId: { type: 'string' }
  },
  required: ['sensorId', 'metricType', 'timestamp', 'value', 'unit']
};

// RF029 slice 4/6 (#672): DataFile per dict-02_DICIONARIO.md ELM-0316..
// ELM-0321. Required fields are the dictionary's 1..1 ones a real caller
// can supply today -- `fileUri`/`checksum`/`fileSizeBytes` map directly
// onto SampleFile.js's real `storageUri`/`checksum`/`fileSize` fields
// (RF007's objstore:// upload path, sample-file.controller.js). `fileId`
// has no direct real-model equivalent yet (SampleFile.js has no id field
// of its own beyond Mongo's `_id`) but is required here for the same
// reason every other entity schema names its own id (participantId,
// specimenId, sensorId).
//
// `fileRole`/`fileFormat` stay optional -- but NOT for the reason this
// comment gave until #681. The vocabulary mismatch it cited as unresolved
// ("the real model's closed `fileType` enum isn't the same vocabulary as
// either dict-02 field") was resolved on the model side by #679, which gave
// `SampleFile.js` real `fileRole` and `fileFormat` fields:
// `SampleFileModel.create` writes `fileRole: data.fileRole || 'raw'` and
// `fileFormat: data.fileFormat || getFileFormatFromType(data.fileType)`,
// with `fileRole` validated against dict-02 ELM-0317's own closed list.
//
// They stay optional because **1..1 on the stored entity is not the same as
// required on input**, and dict-02 says so itself: ELM-0317 carries a
// documented default of `raw`, and ELM-0319's Coding is derivable from the
// container format. `SampleFileModel.create` implements exactly that -- it
// defaults one and derives the other -- so a caller that omits them still
// produces a conformant stored record. Requiring them here would oblige an
// ingesting party to send what the model already supplies, which is a
// stricter contract than the dictionary asks for, not a faithful one.
//
// What is genuinely still missing is a *production* caller: the only path
// that validates against this schema today is the RF029 test-support probe
// (`/api/_test-support/ingestion/probe`), which takes a fully
// caller-supplied payload rather than one derived from a real SampleFile
// record. That remains open -- see #681.
//
// `specimenId` isn't part of dict-02's own
// DataFile entity, but RF007 AC#6 already links files to a specimen in
// practice -- included here, optional, for reference-checking.
const fileSchema = {
  $id: 'canonical.v1.file',
  type: 'object',
  additionalProperties: false,
  properties: {
    fileId: { type: 'string', minLength: 1 },
    specimenId: { type: 'string' },
    fileRole: { type: 'string' },
    fileUri: { type: 'string', minLength: 1 },
    fileFormat: { type: 'string' },
    fileSizeBytes: { type: 'number' },
    checksum: { type: 'string', minLength: 1 }
  },
  required: ['fileId', 'fileUri', 'checksum', 'fileSizeBytes']
};

// RF029 slice 5/6 (#673): Assay per dict-02_DICIONARIO.md ELM-0286..0297
// ("Ensaios e experimentos") -- Assay.js's own header already cites this
// exact ELM range, so this schema mirrors AssayModel.validate()'s real
// required set field-for-field rather than dict-02's 1..1 markings alone:
// `assayId` is deliberately NOT required here (unlike participantSchema's
// participantId) because AssayModel.validate() itself never checks it --
// assayId is purely server-generated (randomUUID() in create()), never
// read from input, so requiring it in the contract would diverge from
// what the real validator actually enforces. `reagentLotIds`/
// `equipmentIds` (RF025 additions, no dict-02 field of their own) and
// `controls` all stay optional, matching the real model's own defaults.
const assaySchema = {
  $id: 'canonical.v1.assay',
  type: 'object',
  additionalProperties: false,
  properties: {
    assayId: { type: 'string', minLength: 1 },
    studyId: { type: 'string', minLength: 1 },
    specimenIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
    assayType: { type: 'string', minLength: 1 },
    omicsDomain: { type: 'string' },
    protocolId: { type: 'string' },
    operatorId: { type: 'string' },
    laboratoryId: { type: 'string' },
    assayDateTime: { type: 'string' },
    assayBatchId: { type: 'string' },
    controls: { type: 'array' },
    reagentLotIds: { type: 'array', items: { type: 'string' } },
    equipmentIds: { type: 'array', items: { type: 'string' } },
    intendedUse: { type: 'string', minLength: 1 }
  },
  required: ['studyId', 'specimenIds', 'assayType', 'protocolId', 'operatorId', 'laboratoryId', 'assayDateTime', 'intendedUse']
};

// RF029 slice 5/6 (#673): Dataset per dict-02_DICIONARIO.md ELM-0416..0423
// ("FAIR e publicação") -- same "mirror the real model's own validate(),
// not just dict-02 cardinality" reasoning as assaySchema above.
// DatasetModel.validate() never checks datasetId either (also purely
// server-generated) -- not required here for the same reason.
// `distributionFiles`/`roCrateManifest` stay optional: DatasetModel's own
// header notes distributionFiles can't be populated before the
// scientific-file linkage routing lands, so an empty/absent array is the
// real system's own normal state, not a gap this slice introduces.
const datasetSchema = {
  $id: 'canonical.v1.dataset',
  type: 'object',
  additionalProperties: false,
  properties: {
    datasetId: { type: 'string', minLength: 1 },
    datasetTitle: { type: 'string', minLength: 1 },
    datasetVersion: { type: 'string', minLength: 1 },
    creators: { type: 'array', minItems: 1 },
    doi: { type: 'string' },
    license: { type: 'string', minLength: 1 },
    distributionFiles: { type: 'array' },
    roCrateManifest: { type: 'string' }
  },
  required: ['datasetTitle', 'datasetVersion', 'creators', 'license']
};

// RF029 slice 6/6 (#674): WorkflowRun per dict-02_DICIONARIO.md
// ELM-0326..0336 ("Proveniência computacional") -- same "mirror the real
// model's own validate() field-for-field" reasoning as assaySchema/
// datasetSchema above, since RF027 (#716) already built WorkflowRunModel
// against this exact ELM range. `workflowRunId` is not required here,
// same precedent as assayId/datasetId -- WorkflowRunModel.create()
// generates it server-side (randomUUID()), never reads it from input.
// `runStatus` mirrors WorkflowRunModel.RUN_STATUSES verbatim rather than
// importing the model (contracts/canonical/v1 stays a standalone schema
// module, no cross-import into src/models, same as every schema above).
// No reference field: workflowId/workflowVersion identify a pipeline
// definition, not a row in an existing collection -- there is no
// "workflows" master collection to check against, unlike Assay's
// studyId. inputFileIds/outputFileIds stay unreferenced for the same
// reason WorkflowRun.js's own header notes them as populated by a
// separate file-linkage route (#716 slice 2/4), and (per #664's own
// precedent) resolving a fileId across this repo's three per-parent file
// collections is out of this thin slice's scope.
// #1322 adds the v2 companions V2E-0477..0480: hardwareProfile and
// environmentManifestUri are required, randomSeed and an unresolved
// datasetSnapshotId optional, each checked as WorkflowRunModel.validate() does.
// #1398: datasetSnapshotId needs a non-whitespace char; a one-letter scheme is a drive path.
const workflowSchema = {
  $id: 'canonical.v1.workflow',
  type: 'object',
  additionalProperties: false,
  properties: {
    workflowRunId: { type: 'string', minLength: 1 },
    workflowId: { type: 'string', minLength: 1 },
    workflowVersion: { type: 'string', minLength: 1 },
    createdBy: { type: 'string', minLength: 1 },
    containerImageDigest: { type: 'string' },
    softwareDependencies: { type: 'array' },
    parameters: { type: 'object' },
    inputFileIds: { type: 'array', items: { type: 'string' } },
    outputFileIds: { type: 'array', items: { type: 'string' } },
    startedAt: { type: 'string' },
    completedAt: { type: 'string' },
    runStatus: { type: 'string', enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'] },
    hardwareProfile: { type: 'object', minProperties: 1 },
    randomSeed: { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 },
    datasetSnapshotId: { type: 'string', minLength: 1, pattern: '\\S' },
    environmentManifestUri: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9+.-]+:\\S+$' }
  },
  required: ['workflowId', 'workflowVersion', 'createdBy', 'startedAt', 'runStatus', 'hardwareProfile', 'environmentManifestUri']
};

// RF029 slice 6/6 (#674): OmicsQualification per dict-02_DICIONARIO.md
// ELM-0337..0342 ("Qualidade específica do ensaio") -- mirrors
// OmicsQualificationModel.validate() field-for-field, same reasoning as
// workflowSchema above. `omicsQualificationId` not required, same
// server-generated-id precedent. `targetAssay` is this schema's one
// FK-shaped field -- it names the Assay this qualification was run
// against, which (unlike WorkflowRun's workflowId) does resolve to a
// real `assays` collection row, so it's the reference this slice's e2e
// proof checks (the same "one cheaply-seedable reference" scope #673
// applied to Assay's own studyId).
const omicsQualificationSchema = {
  $id: 'canonical.v1.omicsQualification',
  type: 'object',
  additionalProperties: false,
  properties: {
    omicsQualificationId: { type: 'string', minLength: 1 },
    targetAssay: { type: 'string', minLength: 1 },
    qcRuleSetVersion: { type: 'string', minLength: 1 },
    qcMetrics: { type: 'array', minItems: 1, items: { type: 'object' } },
    qualificationDecision: { type: 'string', enum: ['eligible', 'ineligible', 'conditional', 'review_required'] },
    limitations: { type: 'string' }
  },
  required: ['targetAssay', 'qcRuleSetVersion', 'qcMetrics', 'qualificationDecision']
};

// RF029 slice 6/6 (#674): OmicsRun per dict-02_DICIONARIO.md ELM-0343..
// 0352 ("Dados ômicos e imagens", genomics/transcriptomics/proteomics/
// metabolomics/microbiome sub-slice -- see OmicsRun.js's own header for
// why the imaging pair, ELM-0353..0356, is out of this model's scope).
// Mirrors OmicsRunModel.validate() field-for-field. `omicsRunId` not
// required, same server-generated-id precedent. `fileLinks` stays
// unreferenced for the same cross-collection-resolution reason as
// workflowSchema's inputFileIds/outputFileIds above.
const omicsRunSchema = {
  $id: 'canonical.v1.omicsRun',
  type: 'object',
  additionalProperties: false,
  properties: {
    omicsRunId: { type: 'string', minLength: 1 },
    modality: { type: 'string', enum: ['genomics', 'transcriptomics', 'proteomics', 'metabolomics', 'microbiome'] },
    referenceAssembly: { type: 'string' },
    mixsChecklist: { type: 'string' },
    fileLinks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          role: { type: 'string', minLength: 1 },
          fileId: { type: 'string', minLength: 1 }
        },
        required: ['role', 'fileId']
      }
    }
  },
  required: ['modality']
};

const intakeSchema = {
  $id: 'canonical.v1.intake',
  type: 'object',
  additionalProperties: false,
  properties: {
    // The intake takes its organization from organizationId and its template
    // from consent, so its participant still refuses both (#1318).
    participant: {
      type: 'object',
      allOf: [{ $ref: 'canonical.v1.participant' }],
      properties: { clinicalUnitId: false, consentTemplateId: false }
    },
    legalRepresentative: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            identityDocument: { type: 'string' },
            phone: { type: 'string' }
          }
        }
      ]
    },
    // The intake takes its participant from participant and records no
    // responses, so its consent still refuses both (#1318).
    consent: {
      type: 'object',
      allOf: [{ $ref: 'canonical.v1.consent' }],
      properties: { participantId: false, responses: false, supersedesConsentId: false }
    },
    specimen: { $ref: 'canonical.v1.specimen' },
    // RNF018 AC5 (#1524): the governance evidence references the intake
    // resolves before certification, in the shape POST /api/quality/preview
    // takes; the resolver judges each entry and fails a malformed one closed.
    governanceEvidence: { type: 'object' },
    // The organization the intake stamps as Sample.organizationId (#1376).
    organizationId: { type: 'string', minLength: 1 },
    diagnosis: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            diagnosisName: { type: ['string', 'null'] },
            icdCode: { type: ['string', 'null'] },
            orphaCode: { type: ['string', 'null'] },
            omimCode: { type: ['string', 'null'] },
            definition: { type: ['string', 'null'] }
          }
        }
      ]
    },
    clinical: { $ref: 'canonical.v1.clinicalData' },
    biomarkers: { type: 'array' }
  },
  required: ['participant', 'consent', 'specimen', 'clinical', 'biomarkers']
};

for (const schema of [participantSchema, specimenSchema, consentSchema, clinicalDataSchema, telemetrySchema, fileSchema, assaySchema, datasetSchema, workflowSchema, omicsQualificationSchema, omicsRunSchema, intakeSchema]) {
  ajv.addSchema(schema);
}

function validate(schemaId, data) {
  const validator = ajv.getSchema(schemaId);
  if (!validator) {
    throw new Error(`Schema não registrado: ${schemaId}`);
  }
  const valid = validator(data);
  return { valid, errors: validator.errors || [] };
}

module.exports = {
  ajv,
  validate,
  schemas: {
    participantSchema,
    specimenSchema,
    consentSchema,
    clinicalDataSchema,
    telemetrySchema,
    fileSchema,
    assaySchema,
    datasetSchema,
    workflowSchema,
    omicsQualificationSchema,
    omicsRunSchema,
    intakeSchema
  }
};
