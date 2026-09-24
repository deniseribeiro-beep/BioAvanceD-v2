const mongoose = require('mongoose');

const ValidationRequirementSchema = new mongoose.Schema(
  {
    miabis: {
      requireTreatmentStatus: { type: Boolean, default: true },
    },
    biomarkers: {
      required: { type: [String], default: [] },
      recommended: { type: [String], default: [] },
    },
    pharmacology: {
      required: { type: [String], default: [] },
      recommended: { type: [String], default: [] },
      treatmentStatuses: {
        type: [String],
        default: ['NAIVE', 'TREATED', 'WASHOUT'],
      },
    },
  },
  { _id: false }
);

const DiseaseSchema = new mongoose.Schema(
  {
    orpha_code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    disease_category: { type: String, trim: true, default: 'Outras Doencas Raras' },
    validation_requirements: { type: ValidationRequirementSchema, default: () => ({}) },
    drug_classes: { type: [String], default: [] },
    active: { type: Boolean, default: true },
  },
  {
    collection: 'diseaseDictionary',
    timestamps: true,
  }
);

module.exports = mongoose.models.Disease || mongoose.model('Disease', DiseaseSchema);
