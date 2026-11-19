require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const { Worker } = require('bullmq');
const redis = require('../config/redis');
const { initRedis } = require('../config/queue');
const { validateRedisOnly } = require('../config/validateEnv');
const logger = require('../utils/logger');
const { withJobRequestContext } = require('../utils/requestContext');
const { withJobMetrics } = require('../infrastructure/metrics/jobMetrics');
const patientWorker = require('./workers/patient-worker');
const sampleWorker = require('./workers/sample-worker');
const resultWorker = require('./workers/result-worker');
const temperatureWorker = require('./workers/temperature-worker');
const importAsyncService = require('../services/import-async.service');
const batchValidationEngine = require('../services/batch-validation-engine.service');
const { connectDB } = require('../database/mongo');
const { connectMongoDB } = require('../infrastructure/database/mongodb/connection');
const env = require('../config/env');
const { assertReadiness } = require('../foundation/readiness');

// #1040: observability-only, matching this file's own fatal-error style
// (logger.error + process.exit(1), same as the require.main block's
// initWorker().catch() below). The process must still die -- do NOT turn
// this into a swallow/continue path. Three call sites deliberately depend on
// "an unhandled rejection kills the process" staying true:
// src/services/auth.service.js:540, src/services/consent.service.js:911 and
// src/utils/collectionResolver.js:23.
//
// Registered before any other startup work in this module. Guarded on
// `process`, not on this module, because src/workers/worker.js requires this
// file directly, so both files' handler-registration code can run in the
// SAME worker process -- the guard is what keeps that a single registration
// instead of two. server.js and neo4jProjection.worker.js register the same
// pair in their own processes.
if (!process.__BIOAVANCE_1040_PROCESS_HANDLERS_INSTALLED__) {
  process.__BIOAVANCE_1040_PROCESS_HANDLERS_INSTALLED__ = true;

  process.on('unhandledRejection', (reason) => {
    logger.error('❌ [#1040] unhandledRejection não tratada -- encerrando worker:', reason);
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    logger.error('❌ [#1040] uncaughtException -- encerrando worker:', err);
    process.exit(1);
  });
}

// Lazy getter para evitar TDZ/ciclos de require
const getNotificationService = () => require('../services/notification.service');

/**
 * Worker de Importação
 * Processa jobs da fila de importação
 */

let worker = null;
let notificationWorker = null;
let db = null;
let logLevelPoll = null;

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

    // RF022 AC4/AC9, RNF014 C7 (#1551): as the API does, the worker consumes
    // no queue unless the newest ReadinessReport is `ready` for this build's
    // release. A refusal throws into the catch below, which rethrows; the
    // entry points (worker.js, the require.main block) exit 1.
    if (env.FOUNDATION_READINESS_REQUIRED) {
      const report = await assertReadiness(db, { environment: env.NODE_ENV });
      logger.info(`[RF022] ReadinessReport ${report.readinessReportId} ready (${report.canonicalModelReleaseId})`);
    }

    // #826: connectDB() abre apenas a conexão do driver nativo. Um modelo
    // Mongoose sem conexão enfileira cada operação e a rejeita após 10s, em
    // silêncio. #830 levou StagingImport para o driver nativo; o único modelo
    // Mongoose que este worker ainda alcança é o registrado em
    // models/Sample.js, que nada consulta. A conexão fica enquanto esse
    // registro existir -- worker-mongoose-connection.arch.test.js exige isso.
    await connectMongoDB();

    // #1260: the worker logs through the same logger as the API, so it
    // follows security_config's logging.level the same way server.js does:
    // once now, then on a poll. syncLogLevel never throws.
    const securityService = require('../services/security.service');
    await securityService.syncLogLevel(db);
    logLevelPoll = setInterval(() => securityService.syncLogLevel(db), 60 * 1000);
    logLevelPoll.unref();

    // Inicializa Redis (usa instância comum)
    const connection = initRedis();
    
    if (!connection) {
      throw new Error('Redis não foi inicializado');
    }

    // Cria worker
    worker = new Worker(
      'import-queue',
      // #1468 (RNF015 C1/C3): the context is outermost, so the metrics record
      // carries the job's correlation id.
      withJobRequestContext(withJobMetrics('import-queue', () => db, async (job) => {
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
            const attemptNumber = (job?.attemptsMade || 0) + 1;
            const attemptsAllowed = Math.max(1, Number(job?.opts?.attempts) || 1);

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
              // RULE-025 (#1582): the listable names of the fields stripped at
              // receipt, and one unlisted entry ('') per other field, so the
              // reading's issue counts them without naming them.
              const listedFields = Array.isArray(job.data.strippedFields) ? job.data.strippedFields.filter((field) => typeof field === 'string') : [];
              const unlistedFieldCount = Number.isInteger(job.data.unlistedFieldCount) && job.data.unlistedFieldCount > 0 ? job.data.unlistedFieldCount : 0;
              const strippedFields = [...listedFields, ...Array(unlistedFieldCount).fill('')];
              await iotStreamingService.processTemperatureData(db, temperatureData, { strippedFields });
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

          // #890: a run that finished normally but wrote nothing because
          // every processed entry hit an unimplemented/unsupported format
          // stub (.raw / generic-file) must not be reported as a plain
          // 'completed' -- that reads as a successful import at 100% having
          // written zero records. A CSV whose rows failed for cause (RF029
          // staging/quarantine) stays 'completed'; only the
          // unprocessedFormats signal routes here, per RNF015 AC#7.
          const producedNothing = result.success === 0 && (result.unprocessedFormats || 0) > 0;
          const completionStatus = producedNothing ? 'completed_no_data' : 'completed';

          // Atualiza status para completed
          await updateJobStatus(db, jobID, completionStatus, 100, {
            totalRecords: result.total,
            successCount: result.success,
            errorCount: result.errors.length,
            errors: result.errors,
            unprocessedFormats: result.unprocessedFormats || 0,
            fhirResources: result.fhirResources || [],
            processingTime: result.processingTime || 0,
            // #1007: spread condicional, nao `|| 0`. ResultsPage.tsx gateia
            // os tiles "Ignorados"/"Duplicados" em `!== undefined` justamente
            // para que um job NAO CONTADO omita o tile em vez de afirmar zero
            // (#925). O `|| 0` garantia definedness, entao o gate nunca podia
            // disparar: result-worker.js e temperature-worker.js nao retornam
            // nenhum dos dois campos em nenhum ramo, e `results` e o unico
            // dataType que ResultsPage consegue exibir -- logo todo job
            // exibivel mostrava "Ignorados: 0" como afirmacao sobre um numero
            // que ninguem mediu. patient-worker/sample-worker sempre retornam
            // ambos (import-lgpd.service inicializa os dois em 0), entao o
            // zero MEDIDO da importacao LGPD continua aparecendo.
            ...(result.skipped !== undefined ? { skippedRecords: result.skipped } : {}),
            // #931: quantas das `errorCount` rejeicoes foram por duplicidade.
            // Subconjunto de errorCount, nao um balde a mais -- os tres sites
            // de deteccao em import-lgpd.service empurram para `errors` e
            // fazem `continue`, entao a linha ja esta contada la.
            ...(result.duplicates !== undefined ? { duplicatesFound: result.duplicates } : {}),
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
          // #890: deliberately left as the literal 'completed' here (not
          // completionStatus) -- bounding blast radius on unaudited
          // consumers of this AuditLog action string.
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
            },
            // #1105: this is the import WORKER process, not an HTTP request.
            // Before this it landed on 'api' via Log.js:124's default -- a
            // canonical dict-02 P1X-0331 value that is simply wrong, and the
            // reason "show me everything the import worker did" was a guess
            // rather than a query.
            { source: 'worker' }
          );

          // Envia notificação assíncrona
          await getNotificationService().notifyJobCompleted(userID, {
            jobID,
            status: completionStatus,
            dataType: dataTypeNormalized,
            fileName: fileName,
            successCount: result.success,
            errorCount: result.errors.length,
            completedAt: new Date(),
          });

          logger.info(`✅ Job ${jobID} completado com sucesso`);

          return result;
        } catch (error) {
          // #900: same attempt-awareness as the batch path above. bullmq runs
          // this catch once per ATTEMPT, so an unguarded 'failed' write plus
          // notifyJobFailed meant one failing job flipped the record to failed
          // at t=0 and sent the user up to three "import failed" notifications
          // for a run that could still succeed.
          const attemptNumber = (job?.attemptsMade || 0) + 1;
          const attemptsAllowed = Math.max(1, Number(job?.opts?.attempts) || 1);
          const isFinalAttempt = attemptNumber >= attemptsAllowed;

          logger.error(
            `❌ Erro ao processar job ${jobID} (tentativa ${attemptNumber}/${attemptsAllowed}):`,
            error
          );

          // Only the last attempt is terminal. Earlier ones stay 'processing'
          // and record the attempt, so the failure is visible without claiming
          // the job is over.
          await updateJobStatus(
            db,
            jobID,
            isFinalAttempt ? 'failed' : 'processing',
            0,
            {
              errors: [{
                error: `Tentativa ${attemptNumber}/${attemptsAllowed}: ${error.message}`,
                stack: error.stack,
              }],
              ...(isFinalAttempt ? { completedAt: new Date() } : {}),
            }
          );

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
            { action: 'IMPORT', jobID, dataType: dataTypeNormalized, fileName },
            // #1105: worker process, not an HTTP request -- same as the
            // logImport site above.
            { source: 'worker' }
          );

          // #900: only notify once, on the terminal attempt. The audit entry
          // above is deliberately left per-attempt -- each failure really did
          // happen and an audit trail should say so -- but a user-facing
          // "import failed" push for an attempt that will be retried is wrong.
          if (isFinalAttempt) {
            await getNotificationService().notifyJobFailed(userID, {
              jobID,
              status: 'failed',
              dataType: dataTypeNormalized,
              fileName: fileName,
              error: error.message,
              completedAt: new Date(),
            });
          }

          throw error;
        }
      })),
      {
        connection,
        // #971: default 1, NOT 2. Every duplicate check on the import path is a
        // non-atomic read-then-write -- checkDuplicatePatient/findOne({barcode})
        // then insertOne, with no transaction and no findOneAndUpdate. Within one
        // job the row loop awaits each insert, so a file cannot duplicate against
        // itself (#942); ACROSS jobs nothing serialises them. Samples survive that
        // on samples_barcode_unique_v1 (#936); participants have no unique index at
        // all (#941), so the loser is a second Participant record for one person,
        // silently, with both jobs reporting success.
        // Raise this only once the participant identity key has a real unique index.
        // Pinned by tests/unit/import-worker.test.js.
        concurrency: parseInt(process.env.WORKER_CONCURRENCY || '1', 10),
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
        withJobRequestContext(withJobMetrics('notification-queue', () => db, async (job) => {
          if (job.name !== 'consent-notification') {
            logger.warn(`Job desconhecido em notification-queue: ${job.name}`);
            return null;
          }

          const notificationService = getNotificationService();
          return notificationService.processConsentNotificationJob(job.data, db);
        })),
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
  if (logLevelPoll) {
    clearInterval(logLevelPoll);
    logLevelPoll = null;
  }

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

