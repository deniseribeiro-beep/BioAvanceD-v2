const defaultLogger = require('../../utils/logger');
const env = require('../../config/env');

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

      createdSample = await this.sampleRepository.create(sampleData, createOptions);

      const strictMode = this.resolveStrictMode(sampleData);
      const lineagePayload = this.buildLineagePayload(createdSample, sampleData, command);

      try {
        await this.persistTopology(lineagePayload);
        topologySynced = true;
      } catch (neo4jError) {
        if (strictMode) {
          await this.rollbackMongoSample(createdSample);
          const strictError = new Error(`STRICT_MODE_BLOCKED: ${neo4jError.message || 'Falha ao persistir linhagem no Neo4j'}`);
          strictError.code = 'STRICT_MODE_BLOCKED';
          strictError.statusCode = 403;
          throw strictError;
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
      sampleId: String(createdSample?._id || createdSample?.id || sampleData?.id),
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

  async persistTopology(lineagePayload) {
    if (!this.lineageRepository) {
      throw new Error('LineageRepository não injetado');
    }

    if (typeof this.lineageRepository.createSampleNodeWithParent === 'function' && lineagePayload.parentSampleId) {
      await this.lineageRepository.createSampleNodeWithParent(lineagePayload);
      return;
    }

    if (typeof this.lineageRepository.recordCustodyEvent === 'function') {
      await this.lineageRepository.recordCustodyEvent(lineagePayload);
      return;
    }

    if (typeof this.lineageRepository.createSampleNode === 'function') {
      await this.lineageRepository.createSampleNode(lineagePayload);
      return;
    }

    throw new Error('LineageRepository sem método de persistência topológica compatível');
  }

  async rollbackMongoSample(createdSample) {
    const sampleId = createdSample?._id || createdSample?.id;
    if (!sampleId || typeof this.sampleRepository.deleteById !== 'function') {
      return;
    }

    try {
      await this.sampleRepository.deleteById(String(sampleId));
      this.logger.warn(`[RegisterSampleUseCase] Rollback do MongoDB aplicado para sampleId=${sampleId}`);
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
