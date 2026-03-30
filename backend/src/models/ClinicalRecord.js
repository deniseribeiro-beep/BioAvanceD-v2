// backend/src/models/ClinicalRecord.js

const mongoose = require('mongoose');

// Subschema para fenótipos HPO
const phenotypeSchema = new mongoose.Schema({
  hpoId: { type: String, required: true },   // Ex: 'HP:0001014'
  label: { type: String, required: true }    // Ex: 'Angiokeratoma'
}, { _id: false });

// Subschema para diagnóstico
const diagnosisSchema = new mongoose.Schema({
  isMainDiagnosis: { type: Boolean, default: false },
  disease: {
    cid: { type: String },                   // Ex: 'E75.2'
    orpha: { type: String },                 // Ex: 'ORPHA:324'
    omim: { type: String },                  // Ex: 'OMIM:301500'
    name: { type: String }                   // Ex: 'Doença de Fabry'
  },
  phenotypes: [phenotypeSchema]              // Array de fenótipos HPO
}, { _id: false });

// Schema principal do prontuário clínico
const clinicalRecordSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true },
  // ...campos de anamnese geral (mantenha os existentes)
  anamneseGeral: {
    tipoSanguineo: String,
    comorbidades: [String],
    historicoFamiliar: String,
    // ...outros campos fixos
  },
  diagnoses: [diagnosisSchema],              // Array de diagnósticos
  // ...outros campos do prontuário
}, { timestamps: true });

module.exports = mongoose.model('ClinicalRecord', clinicalRecordSchema);
