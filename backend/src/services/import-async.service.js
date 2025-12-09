const { getQueue } = require('../config/queue');
const ImportJob = require('../models/ImportJob');
const ImportMetrics = require('../models/ImportMetrics');
const fhirService = require('./fhir.service');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

/**
 * Serviço de Importação Assíncrona
 * Gerencia jobs na fila e processamento assíncrono
 */

class ImportAsyncService {
  /**
   * Valida arquivo e retorna metadata
   */
  async validateFile(file, dataType) {
    const errors = [];
    const metadata = {
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      extension: path.extname(file.originalname).toLowerCase(),
      rowCount: 0,
      headers: [],
    };

    // Valida formato
    const validFormats = {
      patients: ['.csv', '.xlsx', '.json'],
      samples: ['.csv', '.xlsx', '.json'],
      results: ['.zip', '.raw', '.csv'],
      temperature: ['.csv'],
    };

    const validExtensions = validFormats[dataType] || [];
    if (!validExtensions.includes(metadata.extension)) {
      errors.push(`Formato de arquivo inválido. Formatos aceitos: ${validExtensions.join(', ')}`);
    }

    // Valida tamanho (máximo 100MB)
    if (file.size > 100 * 1024 * 1024) {
      errors.push('Arquivo muito grande. Tamanho máximo: 100MB');
    }

    // Valida existência do arquivo
    if (!fs.existsSync(file.path)) {
      errors.push('Arquivo não encontrado');
    }

    return {
      valid: errors.length === 0,
      errors,
      metadata,
    };
  }

  /**
   * Cria job de importação na fila
   */
  async createImportJob(db, userID, file, dataType, options = {}) {
    try {
      const queue = getQueue();
      const jobID = uuidv4();

      // Valida arquivo
      const validation = await this.validateFile(file, dataType);
      if (!validation.valid) {
        throw new Error(`Validação falhou: ${validation.errors.join(', ')}`);
      }

      // Cria job no banco
      const jobData = {
        jobID,
        userID,
        dataType,
        filePath: file.path,
        fileName: file.originalname,
        fileSize: file.size,
        status: 'pending',
        progress: 0,
        metadata: validation.metadata,
        options,
      };

      const job = ImportJob.create(jobData);
      const validationResult = ImportJob.validate(jobData);
      if (!validationResult.isValid) {
        throw new Error(`Dados do job inválidos: ${validationResult.errors.join(', ')}`);
      }

      // Salva job no banco
      const jobsCollection = db.collection('importJobs');
      await jobsCollection.insertOne({
        ...job.toJSON(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Adiciona job na fila
      const queueJob = await queue.add(
        'import',
        {
          jobID,
          userID,
          dataType,
          filePath: file.path,
          fileName: file.originalname,
          fileSize: file.size,
          options,
        },
        {
          jobId: jobID,
          priority: options.priority || 0,
        }
      );

      logger.info(`Job ${jobID} criado na fila`);

      return {
        jobID,
        status: 'pending',
        message: 'Job criado com sucesso',
      };
    } catch (error) {
      logger.error('Erro ao criar job de importação:', error);
      throw error;
    }
  }

  /**
   * Obtém status do job
   */
  async getJobStatus(db, jobID) {
    try {
      const jobsCollection = db.collection('importJobs');
      const job = await jobsCollection.findOne({ jobID });

      if (!job) {
        throw new Error('Job não encontrado');
      }

      // Tenta obter status atualizado da fila
      const queue = getQueue();
      let queueJob = null;
      try {
        queueJob = await queue.getJob(jobID);
      } catch (err) {
        // Job pode não estar mais na fila
      }

      if (queueJob) {
        const state = await queueJob.getState();
        const progress = queueJob.progress || 0;

        // Atualiza status no banco se necessário
        if (state !== job.status) {
          await jobsCollection.updateOne(
            { jobID },
            {
              $set: {
                status: state,
                progress: progress,
                updatedAt: new Date(),
              },
            }
          );
          job.status = state;
          job.progress = progress;
        }
      }

      return job;
    } catch (error) {
      logger.error('Erro ao obter status do job:', error);
      throw error;
    }
  }

  /**
   * Lista jobs
   */
  async listJobs(db, filters = {}) {
    try {
      const jobsCollection = db.collection('importJobs');
      const query = {};

      if (filters.userID) {
        query.userID = filters.userID;
      }

      if (filters.dataType) {
        query.dataType = filters.dataType;
      }

      if (filters.status) {
        query.status = filters.status;
      }

      const limit = parseInt(filters.limit || '50', 10);
      const skip = parseInt(filters.skip || '0', 10);

      const jobs = await jobsCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .toArray();

      const total = await jobsCollection.countDocuments(query);

      return {
        jobs,
        total,
        limit,
        skip,
      };
    } catch (error) {
      logger.error('Erro ao listar jobs:', error);
      throw error;
    }
  }

  /**
   * Cancela job
   */
  async cancelJob(db, jobID) {
    try {
      const queue = getQueue();
      const queueJob = await queue.getJob(jobID);

      if (queueJob) {
        await queueJob.remove();
      }

      const jobsCollection = db.collection('importJobs');
      await jobsCollection.updateOne(
        { jobID },
        {
          $set: {
            status: 'cancelled',
            updatedAt: new Date(),
          },
        }
      );

      return { success: true, message: 'Job cancelado com sucesso' };
    } catch (error) {
      logger.error('Erro ao cancelar job:', error);
      throw error;
    }
  }

  /**
   * Salva métricas de importação
   */
  async saveMetrics(db, jobData) {
    try {
      const metricsCollection = db.collection('importMetrics');

      const metrics = ImportMetrics.create({
        jobID: jobData.jobID,
        userID: jobData.userID,
        dataType: jobData.dataType,
        date: new Date(),
        totalJobs: 1,
        totalRecords: jobData.totalRecords || 0,
        successCount: jobData.successCount || 0,
        errorCount: jobData.errorCount || 0,
        averageProcessingTime: jobData.processingTime || 0,
        fhirResourcesCreated: jobData.fhirResourcesCreated || 0,
        fhirResourcesUpdated: jobData.fhirResourcesUpdated || 0,
      });

      await metricsCollection.insertOne(metrics.toJSON());

      // Atualiza métricas consolidadas (agregação diária)
      await this.updateConsolidatedMetrics(db, jobData);

      logger.info(`Métricas salvas para job ${jobData.jobID}`);
    } catch (error) {
      logger.error('Erro ao salvar métricas:', error);
      // Não lança erro para não interromper o processamento
    }
  }

  /**
   * Atualiza métricas consolidadas
   */
  async updateConsolidatedMetrics(db, jobData) {
    try {
      const metricsCollection = db.collection('importMetrics');
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const consolidated = await metricsCollection.findOne({
        date: { $gte: today, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) },
        dataType: jobData.dataType,
        jobID: null, // Métricas consolidadas não têm jobID
      });

      if (consolidated) {
        await metricsCollection.updateOne(
          { _id: consolidated._id },
          {
            $inc: {
              totalJobs: 1,
              totalRecords: jobData.totalRecords || 0,
              successCount: jobData.successCount || 0,
              errorCount: jobData.errorCount || 0,
              fhirResourcesCreated: jobData.fhirResourcesCreated || 0,
              fhirResourcesUpdated: jobData.fhirResourcesUpdated || 0,
            },
            $set: {
              updatedAt: new Date(),
            },
          }
        );
      } else {
        const newConsolidated = ImportMetrics.create({
          jobID: null,
          userID: null,
          dataType: jobData.dataType,
          date: today,
          totalJobs: 1,
          totalRecords: jobData.totalRecords || 0,
          successCount: jobData.successCount || 0,
          errorCount: jobData.errorCount || 0,
          averageProcessingTime: jobData.processingTime || 0,
          fhirResourcesCreated: jobData.fhirResourcesCreated || 0,
          fhirResourcesUpdated: jobData.fhirResourcesUpdated || 0,
        });

        await metricsCollection.insertOne(newConsolidated.toJSON());
      }
    } catch (error) {
      logger.error('Erro ao atualizar métricas consolidadas:', error);
    }
  }

  /**
   * Obtém relatório do job
   */
  async getJobReport(db, jobID) {
    try {
      const job = await this.getJobStatus(db, jobID);

      return {
        jobID: job.jobID,
        status: job.status,
        dataType: job.dataType,
        fileName: job.fileName,
        totalRecords: job.totalRecords,
        successCount: job.successCount,
        errorCount: job.errorCount,
        errors: job.errors,
        progress: job.progress,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        fhirResources: job.fhirResources || [],
      };
    } catch (error) {
      logger.error('Erro ao obter relatório do job:', error);
      throw error;
    }
  }

  /**
   * Limpa arquivo temporário
   */
  cleanupFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      logger.error('Erro ao limpar arquivo temporário:', error.message);
    }
  }
}

module.exports = new ImportAsyncService();

