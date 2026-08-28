const { randomUUID } = require('crypto');

/**
 * Modelo de validação e estrutura para WorkflowRun (RF027 AC#1/#2/#4,
 * dict-02 ELM-0326..0336, "Proveniência computacional", todos Fase 1).
 *
 * Slice 1/4 of #716 -- model + minimal create/read only, following the
 * same "models/Assay.js" shape. `inputFileIds`/`outputFileIds`
 * (ELM-0332/0333, AC#3) are deliberately left as an empty/optional array
 * here rather than enforced as required (dict-02 marks them 1..*) -- same
 * precedent `models/Dataset.js`'s `distributionFiles` set: populating them
 * needs slice 2/4's own file-linkage routing, so a WorkflowRun can't have
 * any files attached before that lands.
 *
 * AC#4's "executor" has no WorkflowRun-specific field of its own in
 * dict-02 -- it's BaseRecord's shared `createdBy` (ELM-0007, "Governança
 * transversal", Reference, `User/uuid` shape), reused here rather than
 * inventing a new field name, per this repo's own "check BaseRecord
 * before inventing vocabulary" precedent (#669).
 */
const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

class WorkflowRunModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.workflowId || typeof data.workflowId !== 'string' || data.workflowId.trim() === '') {
      errors.push('workflowId é obrigatório');
    }

    if (!data.workflowVersion || typeof data.workflowVersion !== 'string' || data.workflowVersion.trim() === '') {
      errors.push('workflowVersion é obrigatório');
    }

    if (!data.createdBy || typeof data.createdBy !== 'string' || data.createdBy.trim() === '') {
      errors.push('createdBy é obrigatório');
    }

    const startedAt = data.startedAt !== undefined && data.startedAt !== null
      ? new Date(data.startedAt)
      : new Date(NaN);
    if (Number.isNaN(startedAt.getTime())) {
      errors.push('startedAt é obrigatório e deve ser uma data válida');
    }

    if (data.completedAt !== undefined && data.completedAt !== null) {
      const completedAt = new Date(data.completedAt);
      if (Number.isNaN(completedAt.getTime())) {
        errors.push('completedAt deve ser uma data válida');
      }
    }

    if (!RUN_STATUSES.includes(data.runStatus)) {
      errors.push(`runStatus deve ser um de: ${RUN_STATUSES.join(', ')}`);
    }

    if (data.containerImageDigest !== undefined && data.containerImageDigest !== null && typeof data.containerImageDigest !== 'string') {
      errors.push('containerImageDigest deve ser string');
    }

    if (data.softwareDependencies !== undefined && data.softwareDependencies !== null) {
      if (!Array.isArray(data.softwareDependencies)) {
        errors.push('softwareDependencies deve ser um array');
      } else {
        data.softwareDependencies.forEach((dependency, index) => {
          if (!dependency || typeof dependency !== 'object' || Array.isArray(dependency)) {
            errors.push(`softwareDependencies[${index}] deve ser um objeto`);
          }
        });
      }
    }

    if (data.parameters !== undefined && data.parameters !== null) {
      if (typeof data.parameters !== 'object' || Array.isArray(data.parameters)) {
        errors.push('parameters deve ser um objeto');
      }
    }

    if (data.inputFileIds !== undefined && data.inputFileIds !== null) {
      if (!Array.isArray(data.inputFileIds)) {
        errors.push('inputFileIds deve ser um array');
      } else if (data.inputFileIds.some((value) => typeof value !== 'string' || value.trim() === '')) {
        errors.push('inputFileIds deve conter apenas strings não vazias');
      }
    }

    if (data.outputFileIds !== undefined && data.outputFileIds !== null) {
      if (!Array.isArray(data.outputFileIds)) {
        errors.push('outputFileIds deve ser um array');
      } else if (data.outputFileIds.some((value) => typeof value !== 'string' || value.trim() === '')) {
        errors.push('outputFileIds deve conter apenas strings não vazias');
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      workflowRunId: data.workflowRunId || randomUUID(),
      workflowId: data.workflowId,
      workflowVersion: data.workflowVersion,
      createdBy: data.createdBy,
      containerImageDigest: data.containerImageDigest || null,
      softwareDependencies: Array.isArray(data.softwareDependencies) ? data.softwareDependencies.map((dependency) => ({ ...dependency })) : [],
      parameters: data.parameters && typeof data.parameters === 'object' ? { ...data.parameters } : null,
      inputFileIds: Array.isArray(data.inputFileIds) ? [...data.inputFileIds] : [],
      outputFileIds: Array.isArray(data.outputFileIds) ? [...data.outputFileIds] : [],
      startedAt: new Date(data.startedAt),
      completedAt: data.completedAt ? new Date(data.completedAt) : null,
      runStatus: data.runStatus,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = WorkflowRunModel;
module.exports.RUN_STATUSES = RUN_STATUSES;
