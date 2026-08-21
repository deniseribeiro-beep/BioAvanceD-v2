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
    isDeceased: { type: 'boolean' }
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
    consentAcceptedAt: { type: 'string' }
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
// specimenId, sensorId). `fileRole`/`fileFormat` stay optional: dict-02
// types both 1..1, but the real model's closed `fileType` enum
// (RAW|ZIP|CSV|XLS|XLSX|PDF|TXT, a technical container format) isn't the
// same vocabulary as either dict-02 field (fileFormat is EDAM/MIME-coded;
// fileRole is a raw|intermediate|processed|derived|report|manifest
// processing-stage marker) -- reconciling that vocabulary mismatch is out
// of this thin slice's scope. `specimenId` isn't part of dict-02's own
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

const intakeSchema = {
  $id: 'canonical.v1.intake',
  type: 'object',
  additionalProperties: false,
  properties: {
    participant: { $ref: 'canonical.v1.participant' },
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
    consent: { $ref: 'canonical.v1.consent' },
    specimen: { $ref: 'canonical.v1.specimen' },
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

for (const schema of [participantSchema, specimenSchema, consentSchema, clinicalDataSchema, telemetrySchema, fileSchema, assaySchema, datasetSchema, intakeSchema]) {
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
    intakeSchema
  }
};
