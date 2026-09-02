const mongoose = require('mongoose');

const { Schema } = mongoose;

const stagingImportSchema = new Schema(
  {
    jobId: {
      type: String,
      required: true,
      // #941: the redundant `index: true` on this same field was deleted --
      // `unique: true` already implies an index. Both were inert either way.
      // #941: INERT. mongoose connects with autoIndex:false
      // (infrastructure/database/mongodb/connection.js) and nothing calls
      // syncIndexes()/createIndexes(), so this declaration is never built on any
      // stack. Unlike the other inert declarations, the UNIQUE half here guards
      // nothing worth guarding: jobId is a uuidv4 from staging-import.service.js,
      // so collisions are not a real failure mode. What IS wanted is the LOOKUP
      // index -- import-batch.controller and batch-validation-engine do five
      // keyed reads on jobId, all collection scans today.
      unique: true,
      trim: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['staged', 'queued', 'processing', 'completed', 'failed'],
      default: 'staged',
      index: true,
    },
    totalRows: {
      type: Number,
      default: 0,
      min: 0,
    },
    processedRows: {
      type: Number,
      default: 0,
      min: 0,
    },
    importErrors: {
      type: [Schema.Types.Mixed],
      default: [],
    },
    rawData: {
      type: Schema.Types.Mixed,
      required: true,
    },
  },
  {
    collection: 'stagingImports',
    timestamps: true,
    minimize: false,
  }
);

module.exports = mongoose.models.StagingImport || mongoose.model('StagingImport', stagingImportSchema);