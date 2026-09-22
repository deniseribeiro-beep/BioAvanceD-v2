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

// #941: these two declarations are INERT ON THEIR OWN -- mongoose connects
// with autoIndex:false (infrastructure/database/mongodb/connection.js) and
// nothing calls syncIndexes()/createIndexes(), so a Schema.index() here is
// never built on any stack. Do not read either line as the thing that
// enforces the constraint.
//
// BOTH are nonetheless enforced now, natively: utils/storageIndexes.js
// #ensureSensorMetadataIndexes builds sensor_metadata_sensorid_unique_v1
// and sensor_metadata_macaddress_unique_v1, wired into the write path at
// sensor.service.js#linkSensorMetadata on the utils/sampleIndexes.js
// precedent. The declarations are kept as the schema-level statement of
// intent; that helper is what makes them true. Change one, change both.
//
// Why each one matters: linkSensorMetadata does an updateOne({sensorId},
// ..., {upsert:true}), which is correct GIVEN the sensorId index and racy
// without it. macAddress was the sharper gap -- the upsert filter is
// {sensorId}, not {macAddress}, so two sensors could carry one MAC and the
// "macAddress duplicado" error sensor.service.js documents was an E11000
// the database could not produce. Its index is partial
// (partialFilterExpression on $type string) because macAddress reaches the
// document only through $set, behind a guard in the caller -- see that
// helper's module comment for why a plain unique index would be wrong.
SensorMetadataSchema.index({ sensorId: 1 }, { unique: true });
SensorMetadataSchema.index({ macAddress: 1 }, { unique: true });

module.exports = mongoose.models.SensorMetadata || mongoose.model('SensorMetadata', SensorMetadataSchema);