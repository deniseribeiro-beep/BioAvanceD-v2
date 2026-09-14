const mongoose = require('mongoose');

const SensorMetadataSchema = new mongoose.Schema(
  {
    sensorId: { type: String, required: true, trim: true },
    macAddress: { type: String, required: true, trim: true },
    equipment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Equipment',
      default: null,
    },
    device: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Device',
      default: null,
    },
    storageContainer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'StorageContainer',
      default: null,
    },
    temperaturePolicy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TemperaturePolicy',
      default: null,
    },
  },
  {
    collection: 'sensorMetadata',
    timestamps: true,
  }
);

// #941: index authority is the native, awaited write-path helper in
// utils/storageIndexes.js. sensorId is the actual upsert identity and is
// enforced unique there. macAddress remains governed metadata; runtime does
// not use it as an identity/filter, so no uniqueness guarantee is advertised.

module.exports = mongoose.models.SensorMetadata || mongoose.model('SensorMetadata', SensorMetadataSchema);
