const mongoose = require('mongoose');

const { Schema } = mongoose;

const IdentifierSchema = new Schema(
  {
    system: { type: String, required: true },
    value: { type: String, required: true },
    use: { type: String, enum: ['usual', 'official', 'temp', 'secondary'] }
  },
  { _id: false }
);

const HumanNameSchema = new Schema(
  {
    use: { type: String, enum: ['official', 'usual', 'nickname', 'anonymous'] },
    text: { type: String },
    family: { type: String },
    given: [{ type: String }]
  },
  { _id: false }
);

const TelecomSchema = new Schema(
  {
    system: { type: String, enum: ['phone', 'email', 'sms', 'url'] },
    value: { type: String },
    use: { type: String, enum: ['home', 'work', 'mobile', 'temp', 'old'] }
  },
  { _id: false }
);

const AddressSchema = new Schema(
  {
    use: { type: String, enum: ['home', 'work', 'temp'] },
    line: [{ type: String }],
    city: { type: String },
    district: { type: String },
    state: { type: String },
    postalCode: { type: String },
    country: { type: String }
  },
  { _id: false }
);

const PatientFHIRSchema = new Schema(
  {
    resourceType: { type: String, default: 'Patient', immutable: true },
    identifier: { type: [IdentifierSchema], default: [] },
    active: { type: Boolean, default: true },
    name: { type: [HumanNameSchema], default: [] },
    telecom: { type: [TelecomSchema], default: [] },
    gender: { type: String, enum: ['male', 'female', 'other', 'unknown'], required: true },
    birthDate: { type: Date, required: true },
    address: { type: [AddressSchema], default: [] },

    patientID: { type: String, required: true, match: /^\d{8}$/ },
    recordNumber: { type: String, default: null },
    unitAcronym: { type: String, default: null },
    clinicalUnit: { type: String, default: null },

    clinicalProfile: {
      diagnosticHypothesis: { type: String, default: null },
      icdCode: { type: String, default: null },
      hypertension: { type: Boolean, default: false },
      obesity: { type: Boolean, default: false },
      diabetesType1: { type: Boolean, default: false },
      diabetesType2: { type: Boolean, default: false },
      copd: { type: Boolean, default: false },
      ckd: { type: Boolean, default: false },
      asthma: { type: Boolean, default: false },
      smoking: { type: Boolean, default: false },
      alcoholUse: { type: Boolean, default: false },
      antibioticUse: { type: Boolean, default: false },
      antiviralUse: { type: Boolean, default: false },
      insulinUse: { type: Boolean, default: false },
      geneticVariant: { type: String, default: null },
      alphaGal: { type: Number, default: null },
      lysoGb3: { type: Number, default: null }
    }
  },
  {
    collection: 'patients_fhir',
    timestamps: true,
    versionKey: false,
    strict: true
  }
);

PatientFHIRSchema.index({ patientID: 1 }, { unique: true, name: 'uq_patient_fhir_patientID' });
PatientFHIRSchema.index({ 'identifier.system': 1, 'identifier.value': 1 }, { name: 'idx_patient_identifier' });

module.exports = mongoose.models.PatientFHIR || mongoose.model('PatientFHIR', PatientFHIRSchema);
