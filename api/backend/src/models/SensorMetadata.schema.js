const mongoose = require('mongoose');

const SensorMetadataSchema = new mongoose.Schema(
  {
    sensorId: { type: String, required: true, trim: true, index: true },
    macAddress: { type: String, required: true, trim: true, index: true },
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

SensorMetadataSchema.index({ sensorId: 1 }, { unique: true });
SensorMetadataSchema.index({ macAddress: 1 }, { unique: true });

module.exports = mongoose.models.SensorMetadata || mongoose.model('SensorMetadata', SensorMetadataSchema);