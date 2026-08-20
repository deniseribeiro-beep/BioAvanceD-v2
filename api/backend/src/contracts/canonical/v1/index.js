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
// supplied. `thresholdProfileId` also stays optional: dict-02 types it a
// required Reference, but no ThresholdProfile entity exists in this
// codebase yet (RF009's temperaturePolicies collection is the closest
// practical analog, but a distinct shape/name -- introducing a formal
// ThresholdProfile entity is out of this thin slice's scope).
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

for (const schema of [participantSchema, specimenSchema, consentSchema, clinicalDataSchema, telemetrySchema, intakeSchema]) {
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
    intakeSchema
  }
};
