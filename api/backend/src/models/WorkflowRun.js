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
 *
 * The v2 provenance companions V2E-0477..0480 (#1322, RF027 AC1, RNF030
 * C1): `hardwareProfile` and `environmentManifestUri` are required on every
 * write; `randomSeed` is an optional integer, a seed of 0 kept; and
 * `datasetSnapshotId` is accepted but stays optional and unresolved while
 * DatasetSnapshot is written by no flow, the same reasoning as the file ids
 * above. See docs/decisions/2026-10-23-workflow-run-provenance-companions.md.
 * A one-letter scheme is a drive-letter path (`C:\manifests`), not a URI (#1398).
 *
 * RF027 AC6 (#1322): two optional non-dictionary fields, `failureReason`
 * (only on a failed or cancelled run) and `resumesWorkflowRunId` (the failed
 * run this one resumes, checked by services/workflowRun.service.js). See
 * docs/decisions/2026-10-23-workflow-run-failure-and-resume.md.
 */
const ABSOLUTE_URI = /^[A-Za-z][A-Za-z0-9+.-]+:\S+$/;
const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
const FAILURE_STATUSES = ['failed', 'cancelled'];
const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

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

    const hardwareProfile = data.hardwareProfile;
    if (!hardwareProfile || typeof hardwareProfile !== 'object' || Array.isArray(hardwareProfile) || Object.keys(hardwareProfile).length === 0) {
      errors.push('hardwareProfile é obrigatório e deve ser um objeto não vazio');
    }

    if (typeof data.environmentManifestUri !== 'string' || !ABSOLUTE_URI.test(data.environmentManifestUri)) {
      errors.push('environmentManifestUri é obrigatório e deve ser uma URI absoluta');
    }

    if (data.randomSeed !== undefined && data.randomSeed !== null && !Number.isSafeInteger(data.randomSeed)) {
      errors.push('randomSeed deve ser um inteiro');
    }

    if (data.datasetSnapshotId !== undefined && data.datasetSnapshotId !== null) {
      if (typeof data.datasetSnapshotId !== 'string' || data.datasetSnapshotId.trim() === '') {
        errors.push('datasetSnapshotId deve ser uma string não vazia');
      }
    }

    if (data.failureReason !== undefined && data.failureReason !== null) {
      if (!isNonEmptyString(data.failureReason)) {
        errors.push('failureReason deve ser uma string não vazia');
      }
      if (!FAILURE_STATUSES.includes(data.runStatus)) {
        errors.push('failureReason só é permitido quando runStatus é failed ou cancelled');
      }
    }

    if (data.resumesWorkflowRunId !== undefined && data.resumesWorkflowRunId !== null && !isNonEmptyString(data.resumesWorkflowRunId)) {
      errors.push('resumesWorkflowRunId deve ser uma string não vazia');
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
      hardwareProfile: data.hardwareProfile && typeof data.hardwareProfile === 'object' && !Array.isArray(data.hardwareProfile) ? { ...data.hardwareProfile } : null,
      randomSeed: Number.isSafeInteger(data.randomSeed) ? data.randomSeed : null,
      datasetSnapshotId: data.datasetSnapshotId || null,
      environmentManifestUri: data.environmentManifestUri || null,
      failureReason: isNonEmptyString(data.failureReason) ? data.failureReason : null,
      resumesWorkflowRunId: isNonEmptyString(data.resumesWorkflowRunId) ? data.resumesWorkflowRunId : null,
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
