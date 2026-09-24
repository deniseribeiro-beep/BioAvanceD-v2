const mongoose = require('mongoose');
const { Schema } = mongoose;

const DrugDictionarySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    generic_name: { type: String, trim: true },
    code: { type: String, trim: true },
    atc_code: { type: String, trim: true, uppercase: true },
    atc_level_1: { type: String, trim: true, uppercase: true },
    atc_classifications: { type: [String], default: [] },
    synonyms: { type: [String], default: [] },
    drug_class: { type: String, trim: true },
    disease_categories: { type: [String], default: [] },
    source: { type: String, trim: true, default: 'LOCAL' },
    active: { type: Boolean, default: true },
  },
  {
    collection: 'medicationDictionary',
    timestamps: true,
  }
);

module.exports = mongoose.models.DrugDictionary || mongoose.model('DrugDictionary', DrugDictionarySchema);
