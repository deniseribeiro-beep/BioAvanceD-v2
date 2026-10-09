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
    // ELM-0315 (#1316): references to preventive or corrective maintenance
    // records.
    maintenanceRecords: { type: [String], default: [] },
    // #1316, RF017 AC6/AC8: state derived from deviceLifecycleEvents
    // (DeviceLifecycleEvent.js), local fields outside the canon.
    currentLocationId: { type: String, default: null },
    retiredAt: { type: Date, default: null },
  },
  {
    collection: 'devices',
    timestamps: true,
  }
);

module.exports = mongoose.models.Device || mongoose.model('Device', DeviceSchema);
