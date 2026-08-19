const { randomUUID } = require('crypto');

/**
 * Modelo de validação e estrutura para Assay (RF007 AC#6, dict-02
 * ELM-0286..0297, "Ensaios e experimentos", todos Fase 1).
 *
 * Slice 1 of #641 -- models + minimal create/read only, no scientific-file
 * linkage yet (that's #643's scope: generalizing SampleFileController's
 * upload/replace/audit pipeline to accept assayId/datasetId alongside the
 * existing specimenId).
 */
class AssayModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.studyId || typeof data.studyId !== 'string' || data.studyId.trim() === '') {
      errors.push('studyId é obrigatório');
    }

    if (!Array.isArray(data.specimenIds) || data.specimenIds.length === 0) {
      errors.push('specimenIds é obrigatório e deve ser um array não vazio');
    } else if (data.specimenIds.some((value) => typeof value !== 'string' || value.trim() === '')) {
      errors.push('specimenIds deve conter apenas strings não vazias');
    }

    if (!data.assayType || typeof data.assayType !== 'string' || data.assayType.trim() === '') {
      errors.push('assayType é obrigatório');
    }

    if (!data.protocolId || typeof data.protocolId !== 'string' || data.protocolId.trim() === '') {
      errors.push('protocolId é obrigatório');
    }

    if (!data.operatorId || typeof data.operatorId !== 'string' || data.operatorId.trim() === '') {
      errors.push('operatorId é obrigatório');
    }

    if (!data.laboratoryId || typeof data.laboratoryId !== 'string' || data.laboratoryId.trim() === '') {
      errors.push('laboratoryId é obrigatório');
    }

    const assayDateTime = data.assayDateTime !== undefined && data.assayDateTime !== null
      ? new Date(data.assayDateTime)
      : new Date(NaN);
    if (Number.isNaN(assayDateTime.getTime())) {
      errors.push('assayDateTime é obrigatório e deve ser uma data válida');
    }

    if (!data.intendedUse || typeof data.intendedUse !== 'string' || data.intendedUse.trim() === '') {
      errors.push('intendedUse é obrigatório');
    }

    if (data.omicsDomain !== undefined && data.omicsDomain !== null && typeof data.omicsDomain !== 'string') {
      errors.push('omicsDomain deve ser string');
    }

    if (data.controls !== undefined && data.controls !== null && !Array.isArray(data.controls)) {
      errors.push('controls deve ser um array');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      assayId: randomUUID(),
      studyId: data.studyId,
      specimenIds: [...data.specimenIds],
      assayType: data.assayType,
      omicsDomain: data.omicsDomain || null,
      protocolId: data.protocolId,
      operatorId: data.operatorId,
      laboratoryId: data.laboratoryId,
      assayDateTime: new Date(data.assayDateTime),
      assayBatchId: data.assayBatchId || null,
      controls: Array.isArray(data.controls) ? data.controls : [],
      intendedUse: data.intendedUse,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = AssayModel;
