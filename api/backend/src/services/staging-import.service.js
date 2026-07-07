const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const StagingImport = require('../models/StagingImport');
const { connectMongoDB } = require('../infrastructure/database/mongodb/connection');
const { getQueue } = require('../config/queue');
const logger = require('../utils/logger');

class StagingImportService {
  getStagingDirectory() {
    return path.join(__dirname, '../../uploads/staging-imports');
  }

  sanitizeFileName(fileName) {
    return String(fileName || 'batch-import')
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  buildStagingFilePath(jobId, originalName) {
    const stagingDir = path.join(this.getStagingDirectory(), jobId);
    this.ensureDirectoryExists(stagingDir);
    return path.join(stagingDir, this.sanitizeFileName(originalName));
  }

  async persistRawFile(file, jobId) {
    if (!file || !file.path || !fs.existsSync(file.path)) {
      throw new Error('Arquivo bruto não encontrado para staging');
    }

    const stagingFilePath = this.buildStagingFilePath(jobId, file.originalname);
    fs.copyFileSync(file.path, stagingFilePath);

    return {
      storageType: 'filesystem',
      storagePath: stagingFilePath,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  async createStagingImport(file) {
    await connectMongoDB();

    const jobId = uuidv4();
    const rawData = await this.persistRawFile(file, jobId);

    const stagingImport = await StagingImport.create({
      jobId,
      fileName: file.originalname,
      status: 'staged',
      totalRows: 0,
      processedRows: 0,
      importErrors: [],
      rawData,
    });

    return stagingImport.toObject();
  }

  async dispatchBatchJob(stagingImport) {
    const queue = getQueue();

    if (!queue) {
      throw new Error('Fila de importação indisponível');
    }

    const queueJob = await queue.add(
      'batch-import',
      {
        jobId: stagingImport.jobId,
        stagingImportId: stagingImport.jobId,
        fileName: stagingImport.fileName,
      },
      {
        jobId: stagingImport.jobId,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    await StagingImport.updateOne(
      { jobId: stagingImport.jobId },
      {
        $set: {
          status: 'queued',
          updatedAt: new Date(),
        },
      }
    );

    logger.info(`Job batch-import enfileirado: ${queueJob.id}`);

    return queueJob;
  }

  async createBatchImportJob(file) {
    let stagingImport = null;

    try {
      stagingImport = await this.createStagingImport(file);
      const queueJob = await this.dispatchBatchJob(stagingImport);

      return {
        jobId: stagingImport.jobId,
        stagingImport,
        queueJob,
      };
    } catch (error) {
      if (stagingImport?.jobId) {
        await StagingImport.updateOne(
          { jobId: stagingImport.jobId },
          {
            $set: {
              status: 'failed',
              updatedAt: new Date(),
            },
            $push: {
              importErrors: {
                message: error.message,
                occurredAt: new Date(),
              },
            },
          }
        );
      }

      throw error;
    }
  }
}

module.exports = new StagingImportService();