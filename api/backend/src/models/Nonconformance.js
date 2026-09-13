const { randomUUID } = require('crypto');

/**
 * Modelo de validação e estrutura para Nonconformance (RF025 AC#5/#6,
 * dict-02 ELM-0377..0387, "Gestão da qualidade", todos Fase 1/Core).
 *
 * dict-02's ELM-0385 (`capaId`) points at a `CAPA` entity that the
 * dictionary never itself defines (no "CAPA" row exists anywhere in the
 * canonical catalog) -- the corrective-action fields below are a local
 * design decision (embedded, not a separate collection+capaId reference),
 * same shape as `QuarantineAction.js`'s precedent of locally extending an
 * undocumented vocabulary. "responsável" (AC#6) has no ELM field either
 * (only `detectedBy`, who found it, not who owns the fix) -- added as
 * `correctiveAction.responsible`, a local extension.
 */
const STATUSES = ['open', 'corrective_action_recorded', 'closed'];

class NonconformanceModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.nonconformanceType || typeof data.nonconformanceType !== 'string' || data.nonconformanceType.trim() === '') {
      errors.push('nonconformanceType é obrigatório');
    }

    const detectedAt = data.detectedAt !== undefined && data.detectedAt !== null
      ? new Date(data.detectedAt)
      : new Date(NaN);
    if (Number.isNaN(detectedAt.getTime())) {
      errors.push('detectedAt é obrigatório e deve ser uma data válida');
    }

    if (!data.detectedBy || typeof data.detectedBy !== 'string' || data.detectedBy.trim() === '') {
      errors.push('detectedBy é obrigatório');
    }

    if (!data.description || typeof data.description !== 'string' || data.description.trim() === '') {
      errors.push('description é obrigatório');
    }

    if (!Array.isArray(data.affectedEntityIds) || data.affectedEntityIds.length === 0) {
      errors.push('affectedEntityIds é obrigatório e deve ser um array não vazio');
    } else if (data.affectedEntityIds.some((value) => typeof value !== 'string' || value.trim() === '')) {
      errors.push('affectedEntityIds deve conter apenas strings não vazias');
    }

    if (data.immediateActions !== undefined && data.immediateActions !== null && !Array.isArray(data.immediateActions)) {
      errors.push('immediateActions deve ser um array');
    }

    if (data.rootCause !== undefined && data.rootCause !== null && typeof data.rootCause !== 'string') {
      errors.push('rootCause deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      nonconformanceId: data.nonconformanceId || randomUUID(),
      nonconformanceType: data.nonconformanceType,
      detectedAt: new Date(data.detectedAt),
      detectedBy: data.detectedBy,
      description: data.description,
      affectedEntityIds: [...data.affectedEntityIds],
      immediateActions: Array.isArray(data.immediateActions) ? [...data.immediateActions] : [],
      rootCause: data.rootCause || null,
      correctiveAction: null,
      effectivenessVerification: null,
      closureDate: null,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }

  /** Records the corrective action (AC#6: "ação" + "responsável"). */
  static validateCorrectiveAction(data = {}) {
    const errors = [];

    if (!data.description || typeof data.description !== 'string' || data.description.trim() === '') {
      errors.push('description é obrigatório');
    }

    if (!data.responsible || typeof data.responsible !== 'string' || data.responsible.trim() === '') {
      errors.push('responsible é obrigatório');
    }

    if (data.dueDate !== undefined && data.dueDate !== null && Number.isNaN(new Date(data.dueDate).getTime())) {
      errors.push('dueDate deve ser uma data válida quando informada');
    }

    return { isValid: errors.length === 0, errors };
  }

  /** Records the effectiveness verification (AC#6: "verificação de eficácia"). */
  static validateEffectivenessVerification(data = {}) {
    const errors = [];

    if (!data.verifiedBy || typeof data.verifiedBy !== 'string' || data.verifiedBy.trim() === '') {
      errors.push('verifiedBy é obrigatório');
    }

    if (!data.outcome || !['effective', 'ineffective'].includes(data.outcome)) {
      errors.push("outcome é obrigatório e deve ser um de: effective, ineffective");
    }

    if (data.notes !== undefined && data.notes !== null && typeof data.notes !== 'string') {
      errors.push('notes deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }
}

module.exports = NonconformanceModel;
module.exports.STATUSES = STATUSES;
