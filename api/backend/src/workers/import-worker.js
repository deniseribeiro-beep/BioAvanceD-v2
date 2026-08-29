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
const batchValidationEngine = require('../services/batch-validation-engine.service');
const { connectDB } = require('../database/mongo');
const { connectMongoDB } = require('../infrastructure/database/mongodb/connection');

// Lazy getter para evitar TDZ/ciclos de require
const getNotificationService = () => require('../services/notification.service');

/**
 * Worker de Importação
 * Processa jobs da fila de importação
 */

let worker = null;
let notificationWorker = null;
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

    // #826: connectDB() abre apenas a conexão do driver nativo. Os modelos
    // Mongoose alcançados por este worker (StagingImport, via
    // batch-validation-engine) precisam da conexão do Mongoose -- sem ela o
    // Mongoose enfileira cada operação e a rejeita após 10s, o job falha,
    // retenta indefinidamente e o documento nunca sai de `status: queued`.
    await connectMongoDB();

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
        const dataTypeNormalized = (dataType || '').toString().trim().toLowerCase();
        const allowedTypes = new Set(['patients', 'samples', 'results', 'temperature', 'temperature-iot']);

        if (job.name === 'batch-import') {
          const stagingImportId = job.data?.stagingImportId || job.data?.jobId || job.id;

          logger.info(`📦 Iniciando batch import: ${stagingImportId}`);

          try {
            const batchResult = await batchValidationEngine.processBatchImport(db, stagingImportId, job);

            await batchValidationEngine.updateProgress(stagingImportId, {
              status: batchResult.invalidRows > 0 && batchResult.validRows === 0 && batchResult.partialRows === 0
                ? 'failed'
                : 'completed',
              processedRows: batchResult.processedRows,
            });

            return batchResult;
          } catch (error) {
            // #900: bullmq's Worker calls the processor's catch once per
            // attempt, not once per job (worker.js's moveToFailed() runs every
            // attempt; the retry-vs-fail decision happens inside it, after
            // this catch already ran). attemptsMade is only incremented after
            // the throw, so it plus 1 is the attempt that just failed;
            // Math.max(1, ...) is load-bearing because bullmq defaults
            // opts.attempts to 0 and treats 0 and 1 identically as "one
            // attempt only". This predicate is arithmetic-only -- it would
            // report "still retrying" if a caller ever threw
            // UnrecoverableError or called job.discard(), neither of which
            // happens on this path today.
            const attemptNumber = (job.attemptsMade || 0) + 1;
            const attemptsAllowed = Math.max(1, Number(job.opts.attempts) || 1);

            await batchValidationEngine.recordAttemptFailure(stagingImportId, {
              attemptNumber,
              attemptsAllowed,
              message: error.message,
            });

            logger.error(`❌ Erro ao processar batch-import ${stagingImportId} (tentativa ${attemptNumber}/${attemptsAllowed}):`, error);
            throw error;
          }
        }

        if (!dataTypeNormalized) {
          throw new Error(`dataType ausente no job ${job.id || jobID || '(sem id)'}`);
        }
        if (!allowedTypes.has(dataTypeNormalized)) {
          throw new Error(`Tipo de dados não suportado: ${dataType}`);
        }

        logger.info(`🔄 Processando job ${jobID || job.id} - Tipo: ${dataTypeNormalized}`);

        try {
          // Atualiza status para processing
          await updateJobStatus(db, jobID, 'processing', 0, { startedAt: new Date() });

          // Notifica início
          const notificationService = getNotificationService();
          await notificationService.notifyJobStarted(userID, {
            jobID,
            status: 'processing',
            dataType: dataTypeNormalized,
            fileName,
            progress: 0,
          });

          let result;

          // Processa baseado no tipo
          switch (dataTypeNormalized) {
            case 'patients':
              result = await patientWorker.process(db, jobID, filePath, options);
              break;
            case 'samples': {
              // #483: mirrors neo4jProjection.worker.js's connectNeo4j() use —
              // this worker process never connects Neo4j on its own, so the
              // lineage driver has to be established here, fail-open, before
              // handing off. userID threads the queuing user through for
              // audit-trail attribution (sample-worker.js resolves it to a
              // name/role); options never carried it before.
              let neo4jDriver = null;
              try {
                const { connectNeo4j } = require('../infrastructure/database/neo4j/connection');
                neo4jDriver = await connectNeo4j();
              } catch (neo4jError) {
                logger.warn(`[WORKER] Neo4j indisponível para rastreabilidade do job ${jobID}: ${neo4jError.message}`);
              }
              result = await sampleWorker.process(db, jobID, filePath, {
                ...options,
                userID,
                neo4jDriver,
              });
              break;
            }
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
            dataType: dataTypeNormalized,
            totalRecords: result.total,
            successCount: result.success,
            errorCount: result.errors.length,
            processingTime: result.processingTime || 0,
            fhirResourcesCreated: result.fhirResourcesCreated || 0,
            fhirResourcesUpdated: result.fhirResourcesUpdated || 0,
          });

          // Registra no AuditLog conforme fluxograma (entidade segura)
          const auditLogger = require('../utils/auditLogger');
          const entityName = dataTypeNormalized === 'samples'
            ? 'Sample'
            : dataTypeNormalized === 'patients'
              ? 'Patient'
              : dataTypeNormalized === 'results'
                ? 'Result'
                : dataTypeNormalized === 'temperature'
                  ? 'Temperature'
                  : (dataTypeNormalized || 'Import');

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
              dataType: dataTypeNormalized,
              fhirResourcesCreated: result.fhirResourcesCreated || 0,
              fhirResourcesUpdated: result.fhirResourcesUpdated || 0,
              processingTime: result.processingTime || 0,
            }
          );

          // Envia notificação assíncrona
          await getNotificationService().notifyJobCompleted(userID, {
            jobID,
            status: 'completed',
            dataType: dataTypeNormalized,
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
          const entityFailName = dataTypeNormalized === 'samples'
            ? 'Sample'
            : dataTypeNormalized === 'patients'
              ? 'Patient'
              : dataTypeNormalized === 'results'
                ? 'Result'
                : dataTypeNormalized === 'temperature'
                  ? 'Temperature'
                  : (dataTypeNormalized || 'Import');

          await auditLogger.logError(
            null,
            entityFailName,
            error,
            { action: 'IMPORT', jobID, dataType: dataTypeNormalized, fileName }
          );

          // Envia notificação de falha
          await getNotificationService().notifyJobFailed(userID, {
            jobID,
            status: 'failed',
            dataType: dataTypeNormalized,
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
        logger.error(`Rastreamento: ${err.stack}`);
      }
    });

    worker.on('stalled', (jobId) => {
      logger.warn(`⚠️ Job ${jobId} travado (stalled) - tentando recuperar...`);
    });

    worker.on('error', (err) => {
      logger.error('[ERROR] Erro no worker:', err.message);
      if (err.stack) {
        logger.error(`Rastreamento: ${err.stack}`);
      }
    });

    worker.on('active', (job) => {
      logger.info(`🔄 Job ${job.id} iniciado`);
    });

    logger.info('✅ Worker de importação inicializado');

    if (!notificationWorker) {
      notificationWorker = new Worker(
        'notification-queue',
        async (job) => {
          if (job.name !== 'consent-notification') {
            logger.warn(`Job desconhecido em notification-queue: ${job.name}`);
            return null;
          }

          const notificationService = getNotificationService();
          return notificationService.processConsentNotificationJob(job.data);
        },
        {
          connection,
          concurrency: parseInt(process.env.NOTIFICATION_WORKER_CONCURRENCY || '3', 10),
          limiter: {
            max: parseInt(process.env.NOTIFICATION_WORKER_RATE_MAX || '3', 10),
            duration: parseInt(process.env.NOTIFICATION_WORKER_RATE_DURATION || '1000', 10),
          }
        }
      );

      notificationWorker.on('completed', (job) => {
        logger.info(`✅ Job de notificação ${job.id} completado`);
      });

      notificationWorker.on('failed', (job, err) => {
        logger.error(`❌ Job de notificação ${job?.id} falhou:`, err.message);
      });

      notificationWorker.on('error', (err) => {
        logger.error('[ERROR] Erro no worker de notificações:', err.message);
      });

      logger.info('✅ Worker de notificações inicializado');
    }

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

  if (notificationWorker) {
    await notificationWorker.close();
    notificationWorker = null;
    logger.info('✅ Worker de notificações fechado');
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

