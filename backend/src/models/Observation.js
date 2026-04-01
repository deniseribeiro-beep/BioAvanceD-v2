// backend/src/models/Observation.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const ObservationSchema = new Schema({
  observationID: { type: String, required: true, unique: true },
  sampleID: { type: String },
  fhir: { type: Object },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'observations' });

const Observation = mongoose.models.Observation || mongoose.model('Observation', ObservationSchema);

module.exports = Observation;
