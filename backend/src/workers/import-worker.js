require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { Worker } = require('bullmq');
const redis = require('../config/redis');
const { initRedis } = require('../config/queue');
const { validateRedisOnly } = require('../config/validateEnv');
const logger = require('../utils/logger');
const patientWorker = require('./workers/patient-worker');
const sampleWorker = require('./workers/sample-worker');
const resultWorker = require('./workers/result-worker');
const temperatureWorker = require('./workers/temperature-worker');
const importAsyncService = require('../services/import-async.service');
const { connectDB } = require('../database/mongo');

// Lazy getter para evitar TDZ/ciclos de require
const getNotificationService = () => require('../services/notification.service');

/**
 * Worker de Importação
 * Processa jobs da fila de importação
 */

let worker = null;
let db = null;

/**
 * Inicializa worker
 */
async function initWorker() {
  if (worker) {
    return worker;
  }

  try {
    // Valida variáveis Redis antes de continuar
    const isValid = validateRedisOnly(process.env.NODE_ENV === 'development', true);
    
    if (!isValid && process.env.NODE_ENV === 'development') {
      logger.warn('[WARN] Worker não será inicializado (Redis não configurado)');
      throw new Error('Redis não configurado');
    }

    // Conecta ao banco
    db = await connectDB();

    // Inicializa Redis (usa instância comum)
    const connection = initRedis();
    
    if (!connection) {
      throw new Error('Redis não foi inicializado');
    }

    // Cria worker
    worker = new Worker(
      'import-queue',
      async (job) => {
        const { jobID, userID, dataType, filePath, fileName, options } = job.data;

        logger.info(`🔄 Processando job ${jobID} - Tipo: ${dataType}`);

        try {
          // Atualiza status para processing
          await updateJobStatus(db, jobID, 'processing', 0, { startedAt: new Date() });

          // Notifica início
          const notificationService = getNotificationService();
          await notificationService.notifyJobStarted(userID, {
            jobID,
            status: 'processing',
            dataType,
            fileName,
            progress: 0,
          });

          let result;

          // Processa baseado no tipo
          switch (dataType) {
            case 'patients':
              result = await patientWorker.process(db, jobID, filePath, options);
              break;
            case 'samples':
              result = await sampleWorker.process(db, jobID, filePath, options);
              break;
            case 'results':
              result = await resultWorker.process(db, jobID, filePath, options);
              break;
            case 'temperature':
              result = await temperatureWorker.process(db, jobID, filePath, options);
              break;
            case 'temperature-iot':
              // Processa dados de IoT streaming
              const iotStreamingService = require('../services/iot-streaming.service');
              const temperatureData = job.data.temperatureData;
              await iotStreamingService.processTemperatureData(db, temperatureData);
              result = {
                total: 1,
                success: 1,
                errors: [],
                processingTime: 0,
                fhirResourcesCreated: 1,
                fhirResourcesUpdated: 0,
                fhirResources: [],
              };
              break;
            default:
              throw new Error(`Tipo de dados não suportado: ${dataType}`);
          }

          // Atualiza status para completed
          await updateJobStatus(db, jobID, 'completed', 100, {
            totalRecords: result.total,
            successCount: result.success,
            errorCount: result.errors.length,
            errors: result.errors,
            fhirResources: result.fhirResources || [],
            completedAt: new Date(),
          });

          // Salva métricas
          await importAsyncService.saveMetrics(db, {
            jobID,
            userID,
            dataType,
            totalRecords: result.total,
            successCount: result.success,
            errorCount: result.errors.length,
            processingTime: result.processingTime || 0,
            fhirResourcesCreated: result.fhirResourcesCreated || 0,
            fhirResourcesUpdated: result.fhirResourcesUpdated || 0,
          });

          // Registra no AuditLog conforme fluxograma (entidade segura)
          const auditLogger = require('../utils/auditLogger');
          const entityName = dataType === 'samples'
            ? 'Sample'
            : dataType === 'patients'
              ? 'Patient'
              : dataType === 'results'
                ? 'Result'
                : dataType === 'temperature'
                  ? 'Temperature'
                  : (dataType || 'Import');

          auditLogger.init(db);
          await auditLogger.logImport(
            null, // req não disponível no worker
            entityName,
            'completed',
            result.total,
            result.success,
            result.errors.length,
            {
              jobID,
              dataType,
              fhirResourcesCreated: result.fhirResourcesCreated || 0,
              fhirResourcesUpdated: result.fhirResourcesUpdated || 0,
              processingTime: result.processingTime || 0,
            }
          );

          // Envia notificação assíncrona
          await getNotificationService().notifyJobCompleted(userID, {
            jobID,
            status: 'completed',
            dataType,
            fileName: fileName,
            successCount: result.success,
            errorCount: result.errors.length,
            completedAt: new Date(),
          });

          logger.info(`✅ Job ${jobID} completado com sucesso`);

          return result;
        } catch (error) {
          logger.error(`❌ Erro ao processar job ${jobID}:`, error);

          // Atualiza status para failed
          await updateJobStatus(db, jobID, 'failed', 0, {
            errors: [{ error: error.message, stack: error.stack }],
            completedAt: new Date(),
          });

          // Registra no AuditLog
          const auditLogger = require('../utils/auditLogger');
          auditLogger.init(db);
          const entityFailName = dataType === 'samples'
            ? 'Sample'
            : dataType === 'patients'
              ? 'Patient'
              : dataType === 'results'
                ? 'Result'
                : dataType === 'temperature'
                  ? 'Temperature'
                  : (dataType || 'Import');

          await auditLogger.logError(
            null,
            entityFailName,
            error,
            { action: 'IMPORT', jobID, dataType, fileName }
          );

          // Envia notificação de falha
          await getNotificationService().notifyJobFailed(userID, {
            jobID,
            status: 'failed',
            dataType,
            fileName: fileName,
            error: error.message,
            completedAt: new Date(),
          });

          throw error;
        }
      },
      {
        connection,
        concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2', 10),
        limiter: {
          max: 10,
          duration: 1000,
        },
      }
    );

    // Event listeners robustos
    worker.on('completed', (job) => {
      logger.info(`✅ Job ${job.id} completado`);
    });

    worker.on('failed', (job, err) => {
      logger.error(`❌ Job ${job.id} falhou:`, err.message);
      // Log detalhado para debug
      if (err.stack) {
        logger.error(`Stack trace: ${err.stack}`);
      }
    });

    worker.on('stalled', (jobId) => {
      logger.warn(`⚠️ Job ${jobId} travado (stalled) - tentando recuperar...`);
    });

    worker.on('error', (err) => {
      logger.error('[ERROR] Erro no worker:', err.message);
      if (err.stack) {
        logger.error(`Stack trace: ${err.stack}`);
      }
    });

    worker.on('active', (job) => {
      logger.info(`🔄 Job ${job.id} iniciado`);
    });

    logger.info('✅ Worker de importação inicializado');

    return worker;
  } catch (error) {
    logger.error('❌ Erro ao inicializar worker:', error);
    throw error;
  }
}

/**
 * Atualiza status do job no banco
 */
async function updateJobStatus(db, jobID, status, progress, additionalData = {}) {
  try {
    const jobsCollection = db.collection('importJobs');
    await jobsCollection.updateOne(
      { jobID },
      {
        $set: {
          status,
          progress,
          updatedAt: new Date(),
          ...additionalData,
        },
      }
    );
  } catch (error) {
    logger.error('Erro ao atualizar status do job:', error);
  }
}

/**
 * Fecha worker
 */
async function closeWorker() {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('✅ Worker fechado');
  }
}

// Inicializa worker se executado diretamente
if (require.main === module) {
  initWorker()
    .then(() => {
      logger.info('🚀 Worker de importação iniciado');
    })
    .catch((error) => {
      logger.error('❌ Erro ao iniciar worker:', error);
      process.exit(1);
    });

  // Trata encerramento gracioso
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM recebido, encerrando worker...');
    await closeWorker();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT recebido, encerrando worker...');
    await closeWorker();
    process.exit(0);
  });
}

module.exports = {
  initWorker,
  closeWorker,
};

