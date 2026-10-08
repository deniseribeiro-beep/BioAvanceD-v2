/**
 * Modelo de validação e estrutura para AccessRequest (RF024, ELM-0388..0395)
 */
const crypto = require('crypto');

const REQUEST_ITEM_TYPES = ['specimen', 'dataset', 'file'];
// 'pending' is the create-time default, never a committee input; 'revoked'
// is reachable only from an already-approved/conditioned state via its own
// dedicated action (RF024 AC#5), not through the generic decision endpoint.
const DECISION_STATUSES = ['pending', 'approved', 'rejected', 'conditioned', 'revoked'];
const DECISION_INPUT_STATUSES = ['approved', 'rejected', 'conditioned'];

class AccessRequestModel {
  static validate(data) {
    const errors = [];

    if (!data.requesterId || typeof data.requesterId !== 'string') {
      errors.push('requesterId é obrigatório e deve ser string');
    }

    if (!data.studyId || typeof data.studyId !== 'string') {
      errors.push('studyId é obrigatório e deve ser string');
    }

    // RF024 AC1: "Registrar solicitante, organização, estudo, protocolo, ...".
    // ELM-0389 folds the organization into requesterId's reference; the
    // requester here is a free identifier, so the organization is its own
    // field (the name UserAccount and Actor use, P1X-0187, P1X-0131).
    if (!data.organizationId || typeof data.organizationId !== 'string') {
      errors.push('organizationId é obrigatório e deve ser string');
    }

    if (!data.protocolId || typeof data.protocolId !== 'string') {
      errors.push('protocolId é obrigatório e deve ser string');
    }

    if (!data.requestedPurpose || typeof data.requestedPurpose !== 'string') {
      errors.push('requestedPurpose é obrigatório e deve ser string');
    }

    if (!Array.isArray(data.requestedItems) || data.requestedItems.length === 0) {
      errors.push('requestedItems é obrigatório e deve ser um array não vazio');
    } else {
      data.requestedItems.forEach((item, index) => {
        if (!item || typeof item !== 'object') {
          errors.push(`requestedItems[${index}] deve ser um objeto`);
          return;
        }
        if (!REQUEST_ITEM_TYPES.includes(item.itemType)) {
          errors.push(`requestedItems[${index}].itemType deve ser um de: ${REQUEST_ITEM_TYPES.join(', ')}`);
        }
        if (!item.itemId || typeof item.itemId !== 'string') {
          errors.push(`requestedItems[${index}].itemId é obrigatório e deve ser string`);
        }
      });
    }

    if (data.duoCode !== undefined && data.duoCode !== null && typeof data.duoCode !== 'string') {
      errors.push('duoCode deve ser string quando informado');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data) {
    return {
      accessRequestId: data.accessRequestId || crypto.randomUUID(),
      requesterId: data.requesterId,
      organizationId: data.organizationId,
      studyId: data.studyId,
      protocolId: data.protocolId,
      // The Protocol's version in force at request time (ELM-0071), read by
      // the service from the Protocol, never taken from the request body.
      protocolVersion: data.protocolVersion ?? null,
      requestedPurpose: data.requestedPurpose,
      duoCode: data.duoCode ? String(data.duoCode).trim() : null,
      requestedItems: data.requestedItems.map((item) => ({
        itemType: item.itemType,
        itemId: item.itemId,
        quantity: item.quantity ?? null,
      })),
      consentCompatibility: [],
      compatibilityEvaluatedAt: null,
      overallCompatible: null,
      // RF024 AC4/AC7: each decision carries its own id, the policyVersion and
      // configurationReleaseId in force (V2E-0145/0146's names) and decidedAt.
      committeeDecision: {
        decisionId: null,
        status: 'pending',
        justification: null,
        decidedBy: null,
        decidedAt: null,
        policyVersion: null,
        configurationReleaseId: null,
      },
      approvalPeriod: null,
      distributionStatus: 'pending',
      distributedAt: null,
      // RF024 AC7: the decision that authorized the distribution.
      distributionDecisionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /** Validates a committee decision payload (AC#3) — not the request itself. */
  static validateDecision(data) {
    const errors = [];

    if (!DECISION_INPUT_STATUSES.includes(data.status)) {
      errors.push(`status deve ser um de: ${DECISION_INPUT_STATUSES.join(', ')}`);
    }

    if (!data.justification || typeof data.justification !== 'string' || !data.justification.trim()) {
      errors.push('justification é obrigatório e deve ser string não vazia');
    }

    if (data.approvalPeriod !== undefined && data.approvalPeriod !== null) {
      if (!data.approvalPeriod.start || Number.isNaN(new Date(data.approvalPeriod.start).getTime())) {
        errors.push('approvalPeriod.start deve ser uma data válida quando informado');
      }
      if (data.approvalPeriod.end && Number.isNaN(new Date(data.approvalPeriod.end).getTime())) {
        errors.push('approvalPeriod.end deve ser uma data válida quando informado');
      }
    }

    return { isValid: errors.length === 0, errors };
  }
}

module.exports = AccessRequestModel;
module.exports.REQUEST_ITEM_TYPES = REQUEST_ITEM_TYPES;
module.exports.DECISION_STATUSES = DECISION_STATUSES;
module.exports.DECISION_INPUT_STATUSES = DECISION_INPUT_STATUSES;
