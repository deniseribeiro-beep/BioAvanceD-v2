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
    clinical: {
      type: 'object',
      additionalProperties: false,
      properties: {
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
    },
    biomarkers: { type: 'array' }
  },
  required: ['participant', 'consent', 'specimen', 'clinical', 'biomarkers']
};

for (const schema of [participantSchema, specimenSchema, consentSchema, intakeSchema]) {
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
    intakeSchema
  }
};
