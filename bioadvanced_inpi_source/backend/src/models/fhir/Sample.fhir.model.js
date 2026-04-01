const mongoose = require('mongoose');

const { Schema } = mongoose;

const QuantitySchema = new Schema(
  {
    value: { type: Number, required: true },
    unit: { type: String, required: true },
    system: { type: String, default: 'http://unitsofmeasure.org' },
    code: { type: String, default: 'uL' }
  },
  { _id: false }
);

const ReferenceSchema = new Schema(
  {
    reference: { type: String, required: true },
    type: { type: String },
    identifier: {
      system: { type: String },
      value: { type: String }
    },
    display: { type: String }
  },
  { _id: false }
);

const CodingSchema = new Schema(
  {
    system: { type: String, required: true },
    code: { type: String, required: true },
    display: { type: String }
  },
  { _id: false }
);

const CodeableConceptSchema = new Schema(
  {
    coding: { type: [CodingSchema], default: [] },
    text: { type: String }
  },
  { _id: false }
);

const SampleFHIRSchema = new Schema(
  {
    resourceType: { type: String, default: 'Specimen', immutable: true },
    identifier: {
      type: [
        new Schema(
          {
            system: { type: String, required: true },
            value: { type: String, required: true }
          },
          { _id: false }
        )
      ],
      default: []
    },
    status: { type: String, enum: ['available', 'unavailable', 'unsatisfactory', 'entered-in-error'], default: 'available' },
    type: { type: CodeableConceptSchema, required: true },
    subject: { type: ReferenceSchema, required: true },
    receivedTime: { type: Date, required: true },
    collection: {
      collectedDateTime: { type: Date },
      method: { type: CodeableConceptSchema },
      bodySite: { type: CodeableConceptSchema }
    },

    sampleID: { type: String, default: null },
    barcode: { type: String, default: null },
    patientID: { type: String, required: true, match: /^\d{8}$/ },
    sampleOrigin: { type: String, required: true },
    extractionProtocol: { type: String, required: true },
    linkedProject: { type: String, required: true },
    quality: { type: Number, enum: [0, 1, 2], required: true },
    quantity: { type: QuantitySchema, required: true },

    semanticPointers: {
      mongoSampleId: { type: String, required: true },
      mongoPatientId: { type: String, required: true },
      neo4jSamplePointer: { type: String, default: null },
      lineageManagedInNeo4j: { type: Boolean, default: true }
    },

    storageSnapshot: {
      boxId: { type: String, default: null },
      position: { type: String, default: null }
    }
  },
  {
    collection: 'samples_fhir',
    timestamps: true,
    versionKey: false,
    strict: true,
    suppressReservedKeysWarning: true
  }
);

SampleFHIRSchema.index({ sampleID: 1 }, { unique: true, sparse: true, name: 'uq_sample_fhir_sampleID' });
SampleFHIRSchema.index({ barcode: 1 }, { sparse: true, name: 'idx_sample_fhir_barcode' });
SampleFHIRSchema.index({ patientID: 1, receivedTime: -1 }, { name: 'idx_sample_patient_date' });
SampleFHIRSchema.index({ 'semanticPointers.mongoSampleId': 1 }, { unique: true, name: 'uq_sample_semantic_mongoId' });

module.exports = mongoose.models.SampleFHIR || mongoose.model('SampleFHIR', SampleFHIRSchema);
