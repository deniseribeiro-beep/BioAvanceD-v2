const crypto = require('crypto');

// Canonical Data Model v2.0.0 ImagingDerivedData (ELM-0355/0356), #721: a
// segmentation artifact and the feature sets computed from an image, entered
// by a Coordenador or Administrador (see
// docs/decisions/2026-10-23-imaging-derived-data-structure.md).
// segmentationFile names the DICOM-SEG artifact's file id, unresolved, as
// OmicsRun's fileLinks[].fileId is. Each featureSet entry carries the four
// parts ELM-0356 names: features and software required, parameters and
// regionOfInterest optional. Both fields are optional, but a row must fill
// one. The dictionary gives no link to ImagingStudy, so none is stored.
// create() never throws: validation is the router's job, as for Network.js.

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPresent = (value) => value !== undefined && value !== null;
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function featureSetErrors(entry, index) {
  const at = `featureSet[${index}]`;
  if (!isPlainObject(entry)) return [`${at} deve ser um objeto`];
  const errors = [];
  if (!isNonEmptyString(entry.software)) errors.push(`${at}.software é obrigatório`);
  if (!Array.isArray(entry.features) || entry.features.length === 0) {
    errors.push(`${at}.features é obrigatório`);
  } else if (!entry.features.every((item) => isPlainObject(item) && isNonEmptyString(item.name))) {
    errors.push(`${at}.features deve conter apenas objetos com name`);
  }
  if (isPresent(entry.parameters) && !isPlainObject(entry.parameters)) {
    errors.push(`${at}.parameters deve ser um objeto`);
  }
  if (isPresent(entry.regionOfInterest) && !isNonEmptyString(entry.regionOfInterest)) {
    errors.push(`${at}.regionOfInterest deve ser uma referência não vazia`);
  }
  return errors;
}

class ImagingDerivedDataModel {
  static fieldsOf(data = {}) {
    return {
      imagingDerivedDataId: data.imagingDerivedDataId || crypto.randomUUID(),
      segmentationFile: data.segmentationFile ?? null,
      featureSet: Array.isArray(data.featureSet)
        ? data.featureSet.map((f) => (f && typeof f === 'object' && !Array.isArray(f) ? { ...f } : f))
        : [],
    };
  }

  static validate(data = {}) {
    const errors = [];
    if (isPresent(data.segmentationFile) && !isNonEmptyString(data.segmentationFile)) {
      errors.push('segmentationFile deve ser uma referência não vazia');
    }
    const featureSetIsList = Array.isArray(data.featureSet);
    if (isPresent(data.featureSet) && !featureSetIsList) {
      errors.push('featureSet deve ser uma lista');
    } else if (featureSetIsList) {
      data.featureSet.forEach((entry, index) => errors.push(...featureSetErrors(entry, index)));
    }
    const featureSetGiven = isPresent(data.featureSet) && !(featureSetIsList && data.featureSet.length === 0);
    if (!isPresent(data.segmentationFile) && !featureSetGiven) {
      errors.push('ImagingDerivedData requer segmentationFile ou featureSet');
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return { ...this.fieldsOf(data), createdAt: new Date(), updatedAt: new Date() };
  }
}

module.exports = ImagingDerivedDataModel;
