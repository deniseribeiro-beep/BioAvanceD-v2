const crypto = require('crypto');

// Canonical Data Model v2.0.0 ImagingStudy (ELM-0353/0354), #721: the DICOM
// study UID and its series, entered by a Coordenador or Administrador (see
// docs/decisions/2026-10-23-imaging-study-structure.md). The series sub-shape
// follows the FHIR R4 ImagingStudy.series mapping the catalog names: uid and
// modality required, bodySite, numberOfInstances, instance and endpoint
// optional. A UID follows DICOM PS3.5 section 9.1. modality and bodySite are
// open codes. create() never throws: validation is the router's job, as for
// Network.js.

const DICOM_UID = /^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))+$/;
const DICOM_UID_MAX_LENGTH = 64;

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPresent = (value) => value !== undefined && value !== null;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDicomUid = (value) => typeof value === 'string'
  && value.length <= DICOM_UID_MAX_LENGTH && DICOM_UID.test(value);

function seriesErrors(entry, index) {
  const at = `series[${index}]`;
  if (!isPlainObject(entry)) return [`${at} deve ser um objeto`];
  const errors = [];
  if (!isPresent(entry.uid)) {
    errors.push(`${at}.uid é obrigatório`);
  } else if (!isDicomUid(entry.uid)) {
    errors.push(`${at}.uid deve ser um UID DICOM válido`);
  }
  if (!isNonEmptyString(entry.modality)) errors.push(`${at}.modality é obrigatório`);
  if (isPresent(entry.bodySite) && !isNonEmptyString(entry.bodySite)) {
    errors.push(`${at}.bodySite deve ser um código não vazio`);
  }
  if (isPresent(entry.numberOfInstances)
    && !(Number.isInteger(entry.numberOfInstances) && entry.numberOfInstances >= 0)) {
    errors.push(`${at}.numberOfInstances deve ser um inteiro não negativo`);
  }
  if (isPresent(entry.instance)) {
    if (!Array.isArray(entry.instance)) {
      errors.push(`${at}.instance deve ser uma lista`);
    } else if (!entry.instance.every((item) => isPlainObject(item) && isDicomUid(item.uid))) {
      errors.push(`${at}.instance deve conter apenas objetos com uid DICOM válido`);
    }
  }
  if (isPresent(entry.endpoint)) {
    if (!Array.isArray(entry.endpoint)) {
      errors.push(`${at}.endpoint deve ser uma lista`);
    } else if (!entry.endpoint.every(isNonEmptyString)) {
      errors.push(`${at}.endpoint deve conter apenas referências não vazias`);
    }
  }
  return errors;
}

class ImagingStudyModel {
  static fieldsOf(data = {}) {
    return {
      imagingStudyId: data.imagingStudyId || crypto.randomUUID(),
      dicomStudyUid: data.dicomStudyUid ?? null,
      series: Array.isArray(data.series)
        ? data.series.map((s) => (s && typeof s === 'object' && !Array.isArray(s) ? { ...s } : s))
        : [],
    };
  }

  static validate(data = {}) {
    const errors = [];
    if (!isPresent(data.dicomStudyUid)) {
      errors.push('dicomStudyUid é obrigatório para ImagingStudy (1..1)');
    } else if (!isDicomUid(data.dicomStudyUid)) {
      errors.push('dicomStudyUid deve ser um UID DICOM válido (PS3.5 9.1)');
    }
    if (isPresent(data.series) && !Array.isArray(data.series)) {
      errors.push('series deve ser uma lista');
    } else if (!Array.isArray(data.series) || data.series.length === 0) {
      errors.push('series é obrigatório para ImagingStudy (1..*)');
    } else {
      data.series.forEach((entry, index) => errors.push(...seriesErrors(entry, index)));
      const seen = new Set();
      for (const entry of data.series) {
        if (!isPlainObject(entry) || !isDicomUid(entry.uid)) continue;
        if (seen.has(entry.uid)) errors.push(`series contém uid repetido: ${entry.uid}`);
        seen.add(entry.uid);
      }
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return { ...this.fieldsOf(data), createdAt: new Date(), updatedAt: new Date() };
  }
}

module.exports = ImagingStudyModel;
