const defaultLogger = require('../../utils/logger');
const env = require('../../config/env');

/**
 * RF004/RF023 v2 sample-registration orchestration.
 *
 * The sample repository is responsible for the canonical MongoDB transaction
 * (specimen + birth ledger + normalized physical placement + transactional
 * outbox). Neo4j is deliberately absent here: graph synchronization is an
 * asynchronous projection concern handled by the outbox worker.
 */
class RegisterSampleUseCase {
  constructor({ sampleRepository, logger } = {}) {
    if (!sampleRepository || typeof sampleRepository.create !== 'function') {
      throw new Error('sampleRepository com método create é obrigatório');
    }

    this.sampleRepository = sampleRepository;
    this.logger = logger || defaultLogger;
  }

  async execute(command = {}) {
    const sampleData = command.sampleData || command;
    if (!sampleData || typeof sampleData !== 'object') {
      throw new Error('sampleData inválido para registro de amostra');
    }

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

      const createdSample = await this.sampleRepository.create(sampleData, createOptions);
      const strictMode = this.resolveStrictMode(sampleData);

      return {
        sample: createdSample,
        strictMode,
        topology: {
          // v2 projection is intentionally asynchronous. `synced` therefore
          // cannot be used as a write-success signal anymore.
          synced: false,
          fallbackQueued: false,
          projectionQueued: true
        }
      };
    } catch (error) {
      this.logger.error('[RegisterSampleUseCase] Falha no registro de amostra:', error.message || error);
      throw error;
    }
  }

  resolveStrictMode(sampleData) {
    const baseStrict = String(env.LINEAGE_MODE || 'fail-open').toLowerCase() === 'fail-closed';
    if (baseStrict) return true;
    if (sampleData.isRareDisease === true) return true;

    const riskLevel = String(sampleData.riskLevel || sampleData.riskGrade || '').trim().toLowerCase();
    if (['high', 'critical', 'alto', 'crítico', 'critico'].includes(riskLevel)) return true;

    const riskScore = Number(sampleData.riskScore);
    return Number.isFinite(riskScore) && riskScore >= 7;
  }
}

module.exports = RegisterSampleUseCase;
