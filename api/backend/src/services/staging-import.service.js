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
        // #900: removeOnFail was `false`, which bullmq reads as keep-forever
        // ({count: -1}) and which overrode config/queue.js's 7-day retention.
        // Nothing consumed it: no bull-board/arena is installed and nothing in
        // src/ reads failed jobs -- the only failed-job reference is a
        // getJobCounts health probe. The sibling NotificationService queue
        // chose bounded retention for itself, the option carried no comment or
        // issue number in a file that annotates every deliberate option
        // choice, and the durable failure record now lives on
        // StagingImport.importErrors (which only started working in 058bbd39).
        // Omitting the key restores the queue default: failures are retained
        // 7 days, which still covers manual redis-cli inspection.
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