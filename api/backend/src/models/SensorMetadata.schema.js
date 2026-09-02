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

// #941: INERT. mongoose connects with autoIndex:false
// (infrastructure/database/mongodb/connection.js) and nothing calls
// syncIndexes()/createIndexes(), so this declaration is never built on any
// stack. The constraint below is a real requirement with live writers -- it
// is not decorative -- but it is NOT enforced today. Do not read it as a
// guarantee. Building it means a native ensureIndexes helper on the
// utils/sampleIndexes.js precedent, wired into the write path.
// sensorId in particular: sensor.service.js#linkSensorMetadata does an
// updateOne({sensorId}, ..., {upsert:true}), which is correct GIVEN this
// index and racy without it. macAddress is worse -- the upsert filter is
// {sensorId}, not {macAddress}, so two sensors can already carry one MAC,
// and the "macAddress duplicado" error sensor.service.js documents is an
// E11000 the database cannot currently produce.
SensorMetadataSchema.index({ sensorId: 1 }, { unique: true });
SensorMetadataSchema.index({ macAddress: 1 }, { unique: true });

module.exports = mongoose.models.SensorMetadata || mongoose.model('SensorMetadata', SensorMetadataSchema);