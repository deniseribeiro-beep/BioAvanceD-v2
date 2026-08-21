const { randomUUID } = require('crypto');

/**
 * Modelo de validação e estrutura para OmicsQualification (RF027 AC#6,
 * dict-02 ELM-0337..0342, "Qualidade específica do ensaio", todos Fase 1).
 *
 * Slice 3/4 of #716 -- model + minimal create/read only, following the
 * same "models/Assay.js"/"models/WorkflowRun.js" shape. Independent of
 * slices 1/4-2/4 (WorkflowRun) -- no cross-reference to a WorkflowRun in
 * dict-02's own field list.
 */
const QUALIFICATION_DECISIONS = ['eligible', 'ineligible', 'conditional', 'review_required'];

class OmicsQualificationModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.targetAssay || typeof data.targetAssay !== 'string' || data.targetAssay.trim() === '') {
      errors.push('targetAssay é obrigatório');
    }

    if (!data.qcRuleSetVersion || typeof data.qcRuleSetVersion !== 'string' || data.qcRuleSetVersion.trim() === '') {
      errors.push('qcRuleSetVersion é obrigatório');
    }

    if (!Array.isArray(data.qcMetrics) || data.qcMetrics.length === 0) {
      errors.push('qcMetrics é obrigatório e deve ser um array não vazio');
    } else {
      data.qcMetrics.forEach((metric, index) => {
        if (!metric || typeof metric !== 'object' || Array.isArray(metric)) {
          errors.push(`qcMetrics[${index}] deve ser um objeto`);
        }
      });
    }

    if (!QUALIFICATION_DECISIONS.includes(data.qualificationDecision)) {
      errors.push(`qualificationDecision deve ser um de: ${QUALIFICATION_DECISIONS.join(', ')}`);
    }

    if (data.limitations !== undefined && data.limitations !== null && typeof data.limitations !== 'string') {
      errors.push('limitations deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      omicsQualificationId: randomUUID(),
      targetAssay: data.targetAssay,
      qcRuleSetVersion: data.qcRuleSetVersion,
      qcMetrics: data.qcMetrics.map((metric) => ({ ...metric })),
      qualificationDecision: data.qualificationDecision,
      limitations: data.limitations || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = OmicsQualificationModel;
module.exports.QUALIFICATION_DECISIONS = QUALIFICATION_DECISIONS;
