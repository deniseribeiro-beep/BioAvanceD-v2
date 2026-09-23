const mongoose = require('mongoose');

const { Schema } = mongoose;

const stagingImportSchema = new Schema(
  {
    jobId: {
      type: String,
      required: true,
      // #941: the redundant `index: true` on this same field was deleted --
      // `unique: true` already implies an index. Both were inert either way.
      // #941: this declaration is still INERT ON ITS OWN -- mongoose connects
      // with autoIndex:false (infrastructure/database/mongodb/connection.js)
      // and nothing calls syncIndexes()/createIndexes(), so `unique: true`
      // here never reaches Mongo by itself. It is now BUILT natively by
      // utils/stagingImportIndexes.js, wired into
      // staging-import.service.js#createStagingImport (this collection's only
      // writer), on the utils/sampleIndexes.js precedent.
      //
      // Kept rather than deleted because the native index is unique too, so
      // the declaration is accurate; what it is not is self-executing. The
      // LOOKUP half is what the index buys: import-batch.controller.js:131 and
      // batch-validation-engine.service.js:890/:923/:1076 key on jobId and were
      // collection scans. The UNIQUE half guards little on its own -- jobId is
      // a uuidv4 from that single writer, so collisions are not a real failure
      // mode.
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
      // #941: no `index: true` -- it was inert (autoIndex:false), and no
      // query in src/ filters stagingImports on status; every reader keys
      // on jobId, which utils/stagingImportIndexes.js does build.
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