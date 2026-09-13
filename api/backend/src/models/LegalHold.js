const { randomUUID } = require('crypto');

/**
 * Modelo de validação e estrutura para LegalHold (RF026 AC#2/#6).
 *
 * dict-02 models `legalHold` only as a boolean flag on `DispositionAction`
 * itself (ELM-0411, "Indica impedimento temporário de descarte") -- it has
 * no dedicated entity of its own for imposing/releasing a hold. This is a
 * local design decision, mirroring `QuarantineAction.js`'s own precedent
 * (specimenIds/reasonCodes/actionStatus/authorizedBy) generalized to any
 * entity type, since RF026's hold isn't specimen-specific like RF019's.
 */
const STATUSES = ['active', 'released'];

class LegalHoldModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.targetEntityType || typeof data.targetEntityType !== 'string' || data.targetEntityType.trim() === '') {
      errors.push('targetEntityType é obrigatório');
    }

    if (!Array.isArray(data.targetEntityIds) || data.targetEntityIds.length === 0) {
      errors.push('targetEntityIds é obrigatório e deve ser um array não vazio');
    } else if (data.targetEntityIds.some((value) => typeof value !== 'string' || value.trim() === '')) {
      errors.push('targetEntityIds deve conter apenas strings não vazias');
    }

    if (!data.reason || typeof data.reason !== 'string' || data.reason.trim() === '') {
      errors.push('reason é obrigatório');
    }

    if (!data.imposedBy || typeof data.imposedBy !== 'string' || data.imposedBy.trim() === '') {
      errors.push('imposedBy é obrigatório');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      legalHoldId: data.legalHoldId || randomUUID(),
      targetEntityType: data.targetEntityType,
      targetEntityIds: [...data.targetEntityIds],
      reason: data.reason,
      imposedBy: data.imposedBy,
      imposedAt: new Date(),
      status: 'active',
      releasedBy: null,
      releasedAt: null,
      releaseReason: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = LegalHoldModel;
module.exports.STATUSES = STATUSES;
