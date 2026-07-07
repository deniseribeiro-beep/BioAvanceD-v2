const mongoose = require('mongoose');

const { Schema } = mongoose;

const CodingSchema = new Schema(
  {
    system: { type: String, required: true },
    code: { type: String, required: true },
    display: { type: String }
  },
  { _id: false }
);

const ProvisionSchema = new Schema(
  {
    type: { type: String, enum: ['permit', 'deny'], required: true },
    period: {
      start: { type: Date },
      end: { type: Date }
    },
    purpose: { type: [CodingSchema], default: [] },
    action: { type: [CodingSchema], default: [] },
    securityLabel: { type: [CodingSchema], default: [] }
  },
  { _id: false }
);

const ConsentFHIRSchema = new Schema(
  {
    resourceType: { type: String, default: 'Consent', immutable: true },
    status: { type: String, enum: ['active', 'inactive', 'draft', 'rejected', 'entered-in-error'], required: true },
    scope: {
      coding: {
        type: [CodingSchema],
        default: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/consentscope',
            code: 'research',
            display: 'Research'
          }
        ]
      }
    },
    category: { type: [new Schema({ coding: { type: [CodingSchema], default: [] } }, { _id: false })], default: [] },
    patient: {
      reference: { type: String, required: true },
      identifier: {
        system: { type: String, default: 'https://bioavanced.local/patient-id' },
        value: { type: String, required: true }
      }
    },
    dateTime: { type: Date, required: true },
    performer: { type: [new Schema({ reference: String, display: String }, { _id: false })], default: [] },
    policyRule: {
      coding: { type: [CodingSchema], default: [] }
    },
    provision: { type: ProvisionSchema, required: true },

    patientId: { type: String, required: true, match: /^\d{8}$/ },
    templateId: { type: String, required: true },
    revokedAt: { type: Date, default: null },
    responses: { type: Schema.Types.Mixed, default: {} },

    semanticPointers: {
      mongoConsentId: { type: String, required: true },
      neo4jConsentPointer: { type: String, default: null }
    }
  },
  {
    collection: 'consents_fhir',
    timestamps: true,
    versionKey: false,
    strict: true
  }
);

ConsentFHIRSchema.index({ patientId: 1, status: 1, dateTime: -1 }, { name: 'idx_consent_patient_status_date' });
ConsentFHIRSchema.index({ 'semanticPointers.mongoConsentId': 1 }, { unique: true, name: 'uq_consent_semantic_mongoId' });

module.exports = mongoose.models.ConsentFHIR || mongoose.model('ConsentFHIR', ConsentFHIRSchema);
