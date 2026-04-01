const env = require('../../config/env');
const logger = require('../../utils/logger');
const { ObjectId } = require('mongodb');
const sampleService = require('../../services/sample.service');
const { getCollection } = require('../../utils/collectionResolver');

class RegisterSampleForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegisterSampleForbiddenError';
    this.statusCode = 403;
  }
}

/**
 * Caso de uso: registro de amostra com validação dinâmica de risco.
 *
 * Regras:
 * - Modo padrão vem de LINEAGE_MODE (fail-open/fail-closed).
 * - Se isRareDisease=true ou risco alto => força modo estrito (bloqueante).
 * - Em modo estrito, qualquer falha de consentimento/Neo4j gera rollback e 403.
 * - Em modo permissivo, falha de Neo4j não bloqueia; evento vai para quarentena Redis.
 */
class RegisterSample {
  constructor({ db, lineageRepository, quarantineQueue }) {
    this.db = db;
    this.lineageRepository = lineageRepository || null;
    this.quarantineQueue = quarantineQueue || null;
  }

  async execute(command) {
    if (!this.db) {
      throw new Error('Banco de dados indisponível para registro de amostra');
    }

    const sampleData = command?.sampleData || {};
    const strictMode = this.shouldForceStrictMode(sampleData);
    const riskContext = this.buildRiskContext(sampleData, strictMode);

    await this.assertConsent(sampleData, strictMode);

    let createdSample = null;
    try {
      createdSample = await sampleService.createSample(this.db, sampleData, command?.options || {});

      const lineagePayload = {
        sampleId: String(createdSample._id),
        barcode: createdSample.barcode || sampleData.barcode || null,
        eventType: 'register',
        actorId: command?.actor?.userId || null,
        reason: riskContext.reason,
        happenedAt: new Date(),
        requireEthicalConsent: true
      };

      await this.handleLineage(lineagePayload, strictMode);

      return {
        sample: createdSample,
        lineageMode: strictMode ? 'strict' : 'permissive',
        riskContext
      };
    } catch (error) {
      if (strictMode && createdSample?._id) {
        await this.rollbackMongoSample(String(createdSample._id));
      }

      if (error instanceof RegisterSampleForbiddenError) {
        throw error;
      }

      if (strictMode && this.isLineageError(error)) {
        throw new RegisterSampleForbiddenError('Strict mode ativo: Neo4j indisponível ou validação topológica reprovada (rollback aplicado)');
      }

      throw error;
    }
  }

  shouldForceStrictMode(sampleData) {
    const baseStrict = String(env.LINEAGE_MODE || 'fail-open').toLowerCase() === 'fail-closed';
    if (baseStrict) {
      return true;
    }

    if (sampleData?.isRareDisease === true) {
      return true;
    }

    const riskLevel = String(sampleData?.riskLevel || sampleData?.riskGrade || '').trim().toLowerCase();
    const highRiskValues = ['high', 'critical', 'alto', 'crítico', 'critico', 'severe'];
    if (highRiskValues.includes(riskLevel)) {
      return true;
    }

    const riskScore = Number(sampleData?.riskScore);
    if (Number.isFinite(riskScore) && riskScore >= 7) {
      return true;
    }

    return false;
  }

  buildRiskContext(sampleData, strictMode) {
    return {
      strictMode,
      isRareDisease: sampleData?.isRareDisease === true,
      riskLevel: sampleData?.riskLevel || sampleData?.riskGrade || null,
      riskScore: Number.isFinite(Number(sampleData?.riskScore)) ? Number(sampleData?.riskScore) : null,
      reason: strictMode
        ? 'dynamic_strict_mode_by_risk'
        : 'permissive_mode_default'
    };
  }

  async assertConsent(sampleData, strictMode) {
    const patientId = sampleData?.patientID ? String(sampleData.patientID).trim() : null;
    if (!patientId) {
      if (strictMode) {
        throw new RegisterSampleForbiddenError('Consentimento inválido: patientID ausente');
      }
      return;
    }

    const consentsCollection = await getCollection(this.db, 'consents');
    const activeConsent = await consentsCollection.findOne(
      {
        patientId: patientId,
        status: { $in: ['ACTIVE', 'VALID', 'GRANTED'] }
      },
      {
        sort: { signedAt: -1, updatedAt: -1, createdAt: -1 }
      }
    );

    if (!activeConsent && strictMode) {
      throw new RegisterSampleForbiddenError('Consentimento ético inválido ou ausente para operação em strict mode');
    }
  }

  async handleLineage(lineagePayload, strictMode) {
    if (!this.lineageRepository) {
      if (strictMode) {
        throw new RegisterSampleForbiddenError('Strict mode ativo: repositório Neo4j indisponível');
      }

      await this.enqueueQuarantine(lineagePayload, 'lineage_repository_unavailable');
      return;
    }

    try {
      await this.lineageRepository.validateBeforePersistence(lineagePayload);
      await this.lineageRepository.recordCustodyEvent(lineagePayload);
    } catch (error) {
      if (strictMode) {
        throw new RegisterSampleForbiddenError('Strict mode ativo: validação topológica falhou');
      }

      logger.warn(`[ISO20387][REGISTER_SAMPLE] Neo4j indisponível em modo permissivo. sampleId=${lineagePayload.sampleId}`);
      await this.enqueueQuarantine(lineagePayload, error?.message || 'neo4j_validation_failed');
    }
  }

  async enqueueQuarantine(lineagePayload, reason) {
    if (!this.quarantineQueue || typeof this.quarantineQueue.enqueue !== 'function') {
      logger.warn('[ISO20387][REGISTER_SAMPLE] Quarentena topológica indisponível: evento não enfileirado');
      return;
    }

    await this.quarantineQueue.enqueue(lineagePayload, {
      reason,
      neo4jError: reason
    });
  }

  async rollbackMongoSample(sampleId) {
    try {
      const samplesCollection = await getCollection(this.db, 'samples');
      const objectId = this.tryObjectId(sampleId);
      const filter = objectId ? { _id: objectId } : { _id: sampleId };
      await samplesCollection.deleteOne(filter);
      logger.warn(`[ISO20387][REGISTER_SAMPLE] Rollback Mongo aplicado para sampleId=${sampleId}`);
    } catch (error) {
      logger.error('[ISO20387][REGISTER_SAMPLE] Falha ao aplicar rollback de amostra:', error.message || error);
    }
  }

  tryObjectId(sampleId) {
    try {
      return ObjectId.isValid(sampleId) ? new ObjectId(sampleId) : null;
    } catch (_) {
      return null;
    }
  }

  isLineageError(error) {
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('neo4j') ||
      message.includes('lineage') ||
      message.includes('consentimento') ||
      message.includes('topológica') ||
      message.includes('topologica')
    );
  }
}

module.exports = {
  RegisterSample,
  RegisterSampleForbiddenError
};