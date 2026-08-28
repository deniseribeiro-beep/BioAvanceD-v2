const { randomUUID } = require('crypto');

/**
 * Modelo de validação e estrutura para Assay (RF007 AC#6, dict-02
 * ELM-0286..0297, "Ensaios e experimentos", todos Fase 1).
 *
 * Slice 1 of #641 -- models + minimal create/read only, no scientific-file
 * linkage yet (that's #643's scope: generalizing SampleFileController's
 * upload/replace/audit pipeline to accept assayId/datasetId alongside the
 * existing specimenId).
 *
 * RF025: added `reagentLotIds`/`equipmentIds` (AC#2/#3 linkage, dict-02 has
 * no dedicated join field for either -- mirrors `specimenIds`' own
 * Reference[] shape) and gave `controls` (AC#4) a validated element shape;
 * dict-02's own `controls` row is only typed `BackboneElement[]` with no
 * named sub-fields, so `controlType`/`result`/`reagentLotId`/`notes` below
 * are a local design decision, not a dictionary lookup.
 */
const CONTROL_TYPES = ['positive', 'negative', 'blank', 'standard'];

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

    if (data.controls !== undefined && data.controls !== null) {
      if (!Array.isArray(data.controls)) {
        errors.push('controls deve ser um array');
      } else {
        data.controls.forEach((control, index) => {
          if (!control || typeof control !== 'object' || Array.isArray(control)) {
            errors.push(`controls[${index}] deve ser um objeto`);
            return;
          }
          if (!CONTROL_TYPES.includes(control.controlType)) {
            errors.push(`controls[${index}].controlType deve ser um de: ${CONTROL_TYPES.join(', ')}`);
          }
        });
      }
    }

    if (data.reagentLotIds !== undefined && data.reagentLotIds !== null) {
      if (!Array.isArray(data.reagentLotIds)) {
        errors.push('reagentLotIds deve ser um array');
      } else if (data.reagentLotIds.some((value) => typeof value !== 'string' || value.trim() === '')) {
        errors.push('reagentLotIds deve conter apenas strings não vazias');
      }
    }

    if (data.equipmentIds !== undefined && data.equipmentIds !== null) {
      if (!Array.isArray(data.equipmentIds)) {
        errors.push('equipmentIds deve ser um array');
      } else if (data.equipmentIds.some((value) => typeof value !== 'string' || value.trim() === '')) {
        errors.push('equipmentIds deve conter apenas strings não vazias');
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return {
      assayId: data.assayId || randomUUID(),
      studyId: data.studyId,
      specimenIds: [...data.specimenIds],
      assayType: data.assayType,
      omicsDomain: data.omicsDomain || null,
      protocolId: data.protocolId,
      operatorId: data.operatorId,
      laboratoryId: data.laboratoryId,
      assayDateTime: new Date(data.assayDateTime),
      assayBatchId: data.assayBatchId || null,
      controls: Array.isArray(data.controls) ? data.controls.map((control) => ({
        controlType: control.controlType,
        result: control.result ?? null,
        reagentLotId: control.reagentLotId || null,
        notes: control.notes || null,
      })) : [],
      reagentLotIds: Array.isArray(data.reagentLotIds) ? [...data.reagentLotIds] : [],
      equipmentIds: Array.isArray(data.equipmentIds) ? [...data.equipmentIds] : [],
      intendedUse: data.intendedUse,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  }
}

module.exports = AssayModel;
module.exports.CONTROL_TYPES = CONTROL_TYPES;
