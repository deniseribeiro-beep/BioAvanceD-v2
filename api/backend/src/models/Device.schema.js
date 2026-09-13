const mongoose = require('mongoose');

// dict-02_DICIONARIO.md ELM-0305 to ELM-0315 — Device is a distinct entity
// from Equipment.schema.js (lab equipment: name/model/purchaseDate), scoped
// to instruments/sensors that emit telemetry (freezers, sensors, etc).
const DeviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, trim: true },
    deviceType: { type: String, required: true, trim: true },
    manufacturer: { type: String, trim: true, default: null },
    modelNumber: { type: String, trim: true, default: null },
    serialNumber: { type: String, trim: true, default: null },
    firmwareVersion: { type: String, trim: true, default: null },
    softwareVersion: { type: String, trim: true, default: null },
    qualificationStatus: { type: String, trim: true, default: 'qualified' },
    calibrationDate: { type: Date, default: null },
    calibrationDueDate: { type: Date, default: null },
  },
  {
    collection: 'devices',
    timestamps: true,
  }
);

module.exports = mongoose.models.Device || mongoose.model('Device', DeviceSchema);
