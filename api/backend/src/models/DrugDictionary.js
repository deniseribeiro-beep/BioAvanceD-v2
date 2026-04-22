const mongoose = require('mongoose');
const { Schema } = mongoose;

const DrugDictionarySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    generic_name: { type: String, trim: true, index: true },
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
    collection: 'medication_dictionary',
    timestamps: true,
  }
);

DrugDictionarySchema.index({ name: 'text', generic_name: 'text', atc_code: 'text', code: 'text', synonyms: 'text' }, { name: 'drug_dictionary_text_idx' });
DrugDictionarySchema.index({ generic_name: 1 }, { name: 'drug_dictionary_generic_name_idx' });
DrugDictionarySchema.index({ atc_code: 1 }, { name: 'drug_dictionary_atc_idx' });
DrugDictionarySchema.index({ disease_categories: 1 }, { name: 'drug_dictionary_category_idx' });

module.exports = mongoose.models.DrugDictionary || mongoose.model('DrugDictionary', DrugDictionarySchema);
