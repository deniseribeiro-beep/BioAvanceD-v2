const defaultLogger = require('../../utils/logger');
const env = require('../../config/env');
const { isTransientTransactionError } = require('../../utils/mongoTransaction');

class RegisterSampleUseCase {
  constructor({ sampleRepository, lineageRepository, quarantineService, logger } = {}) {
    if (!sampleRepository || typeof sampleRepository.create !== 'function') {
      throw new Error('sampleRepository com método create é obrigatório');
    }

    this.sampleRepository = sampleRepository;
    this.lineageRepository = lineageRepository || null;
    this.quarantineService = quarantineService || null;
    this.logger = logger || defaultLogger;
  }

  async execute(command = {}) {
    const sampleData = command.sampleData || command;
    if (!sampleData || typeof sampleData !== 'object') {
      throw new Error('sampleData inválido para registro de amostra');
    }

    let createdSample = null;
    let topologySynced = false;
    let fallbackQueued = false;
    try {
      const strictMode = this.resolveStrictMode(sampleData);
      const createOptions = {
        ...(command?.options || {}),
        auditInfo: {
          userId: command?.actor?.userId || null,
          userName: command?.actor?.userName || null,
          userRole: command?.actor?.userRole || null,
          ipAddress: command?.actor?.ipAddress || null,
          userAgent: command?.actor?.userAgent || null
        }
      };

      // RF023 AC3, RNF019 C1: where the create runs a transaction, the
      // register custody event is appended inside it. A strict-mode failure
      // aborts the create, so no sample is left to roll back. A permissive
      // failure has already aborted the transaction at the server (#1370), so
      // it aborts the create too, the create is re-run without this step, and
      // the append follows the commit as below, queued if it fails again. A
      // transient conflict is rethrown as itself for the driver's retry.
      // A create that runs no transaction never calls this, and the append
      // follows the create as below.
      let inTransaction = null;
      if (typeof this.lineageRepository?.recordCustodyEvent === 'function') {
        createOptions.onCreatedInTransaction = async (sampleInTransaction, session) => {
          const lineagePayload = this.buildLineagePayload(sampleInTransaction, sampleData, command);
          inTransaction = { lineagePayload, error: null };
          try {
            await this.persistTopology(lineagePayload, { session });
          } catch (appendError) {
            inTransaction.error = appendError;
            if (isTransientTransactionError(appendError) || strictMode) {
              throw appendError;
            }
            // A plain Error, never a MongoError, so the driver aborts the
            // transaction without retrying it.
            const deferred = new Error(`REGISTER_APPEND_DEFERRED: ${appendError?.message || appendError}`);
            deferred.code = 'REGISTER_APPEND_DEFERRED';
            deferred.cause = appendError;
            throw deferred;
          }
        };
      }

      try {
        createdSample = await this.sampleRepository.create(sampleData, createOptions);
      } catch (createError) {
        if (strictMode && inTransaction?.error) {
          throw this.strictModeBlocked(createError);
        }
        if (strictMode || createError?.code !== 'REGISTER_APPEND_DEFERRED') {
          throw createError;
        }
        const { onCreatedInTransaction, ...createOptionsWithoutHook } = createOptions;
        createdSample = await this.sampleRepository.create(sampleData, createOptionsWithoutHook);
        inTransaction = null;
      }

      if (inTransaction) {
        if (inTransaction.error) {
          fallbackQueued = await this.enqueueForSelfHealing(inTransaction.lineagePayload, inTransaction.error, strictMode);
        } else {
          topologySynced = true;
        }
        return {
          sample: createdSample,
          strictMode,
          topology: {
            synced: topologySynced,
            fallbackQueued
          }
        };
      }

      const lineagePayload = this.buildLineagePayload(createdSample, sampleData, command);

      try {
        await this.persistTopology(lineagePayload);
        topologySynced = true;
      } catch (neo4jError) {
        if (strictMode) {
          await this.rollbackMongoSample(createdSample);
          throw this.strictModeBlocked(neo4jError);
        }

        fallbackQueued = await this.enqueueForSelfHealing(lineagePayload, neo4jError, strictMode);
      }

      return {
        sample: createdSample,
        strictMode,
        topology: {
          synced: topologySynced,
          fallbackQueued
        }
      };
    } catch (error) {
      this.logger.error('[RegisterSampleUseCase] Falha no registro de amostra:', error.message || error);
      throw error;
    }
  }

  strictModeBlocked(cause) {
    const strictError = new Error(`STRICT_MODE_BLOCKED: ${cause?.message || 'Falha ao persistir linhagem no Neo4j'}`);
    strictError.code = 'STRICT_MODE_BLOCKED';
    strictError.statusCode = 403;
    return strictError;
  }

  resolveStrictMode(sampleData) {
    const baseStrict = String(env.LINEAGE_MODE || 'fail-open').toLowerCase() === 'fail-closed';
    if (baseStrict) {
      return true;
    }

    if (sampleData.isRareDisease === true) {
      return true;
    }

    const riskLevel = String(sampleData.riskLevel || sampleData.riskGrade || '').trim().toLowerCase();
    if (['high', 'critical', 'alto', 'crítico', 'critico'].includes(riskLevel)) {
      return true;
    }

    const riskScore = Number(sampleData.riskScore);
    return Number.isFinite(riskScore) && riskScore >= 7;
  }

  buildLineagePayload(createdSample, sampleData, command) {
    return {
      specimenId: String(createdSample?._id || createdSample?.id || sampleData?.id),
      barcode: createdSample?.barcode || sampleData?.barcode || null,
      eventType: 'register',
      actorId: command?.actor?.userId || null,
      happenedAt: new Date(),
      metadata: {
        isRareDisease: sampleData?.isRareDisease === true,
        riskLevel: sampleData?.riskLevel || sampleData?.riskGrade || null,
        riskScore: Number.isFinite(Number(sampleData?.riskScore)) ? Number(sampleData?.riskScore) : null
      }
    };
  }

  async persistTopology(lineagePayload, options = {}) {
    if (!this.lineageRepository) {
      throw new Error('LineageRepository não injetado');
    }

    // #1312: the register step is an outbox append (CUSTODY_EVENT_RECORDED),
    // never a Neo4j write. With `options.session` it is appended inside the
    // create's own transaction; without one it follows the create: a
    // strict-mode failure rolls the sample back, a permissive one queues the
    // step for retry.
    if (typeof this.lineageRepository.recordCustodyEvent === 'function') {
      if (options?.session) {
        await this.lineageRepository.recordCustodyEvent(lineagePayload, { session: options.session });
      } else {
        await this.lineageRepository.recordCustodyEvent(lineagePayload);
      }
      return;
    }

    if (typeof this.lineageRepository.createSampleNode === 'function') {
      await this.lineageRepository.createSampleNode(lineagePayload);
      return;
    }

    throw new Error('LineageRepository sem método de persistência topológica compatível');
  }

  async rollbackMongoSample(createdSample) {
    const specimenId = createdSample?._id || createdSample?.id;
    if (!specimenId || typeof this.sampleRepository.deleteById !== 'function') {
      return;
    }

    try {
      await this.sampleRepository.deleteById(String(specimenId));
      this.logger.warn(`[RegisterSampleUseCase] Rollback do MongoDB aplicado para specimenId=${specimenId}`);
    } catch (rollbackError) {
      this.logger.error('[RegisterSampleUseCase] Falha ao executar rollback no MongoDB:', rollbackError.message || rollbackError);
    }
  }

  async enqueueForSelfHealing(lineagePayload, neo4jError, strictMode) {
    if (!this.quarantineService) {
      this.logger.warn('[RegisterSampleUseCase] Quarentena indisponível. Evento topológico não enfileirado.');
      return false;
    }

    const context = {
      reason: 'neo4j_failure_permissive_mode',
      neo4jError: neo4jError?.message || String(neo4jError),
      strictMode
    };

    if (typeof this.quarantineService.enqueueTopologicalTransaction === 'function') {
      await this.quarantineService.enqueueTopologicalTransaction(lineagePayload, context);
      return true;
    }

    if (typeof this.quarantineService.enqueue === 'function') {
      await this.quarantineService.enqueue(lineagePayload, context);
      return true;
    }

    this.logger.warn('[RegisterSampleUseCase] Quarentena sem método compatível de enqueue.');
    return false;
  }
}

module.exports = RegisterSampleUseCase;
