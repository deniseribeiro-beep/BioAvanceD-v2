const mongoose = require('mongoose');

const { Schema } = mongoose;

const stagingImportSchema = new Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      index: true,
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