const crypto = require('crypto');

// Canonical Data Model v2.0.0 ResearchResource (P1X-0013..0035), RNF008 AC3
// (#1496): the resource a Collection and a Biobank are both linked to
// (ResearchResourceCollection, ResearchResourceBiobank), the only dictionary
// path from a collection to its biobank. Entered by a Coordenador or
// Administrador (see docs/decisions/2026-11-10-research-resource-structures.md).
// create() never throws: validation is the router's job, as for Biobank.js.

const CODE_ARRAYS = ['sampleCollectionSettings', 'researchResourceDesigns', 'inclusionCriteria'];
const OTHER_ARRAYS = ['datasetTypes', 'storageTemperatures', 'diseases', 'useAccessConditions', 'publications'];
const DECIMALS = ['ageLow', 'ageHigh'];

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPresent = (value) => value !== undefined && value !== null;
const asArray = (value) => (Array.isArray(value) ? value : []);

function isContactInformation(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).some(isNonEmptyString);
}

class ResearchResourceModel {
  static fieldsOf(data = {}) {
    return {
      researchResourceId: data.researchResourceId || crypto.randomUUID(),
      acronym: data.acronym ?? null,
      name: data.name ?? null,
      url: data.url ?? null,
      contactInformation: asArray(data.contactInformation),
      description: data.description ?? null,
      sampleSource: data.sampleSource ?? null,
      sexCategories: asArray(data.sexCategories),
      ageLow: data.ageLow ?? null,
      ageHigh: data.ageHigh ?? null,
      ageLowUnit: data.ageLowUnit ?? null,
      ageHighUnit: data.ageHighUnit ?? null,
      datasetTypes: asArray(data.datasetTypes),
      sampleTypes: asArray(data.sampleTypes),
      storageTemperatures: asArray(data.storageTemperatures),
      diseases: asArray(data.diseases),
      sampleCollectionSettings: asArray(data.sampleCollectionSettings),
      researchResourceDesigns: asArray(data.researchResourceDesigns),
      useAccessConditions: asArray(data.useAccessConditions),
      researchResourceStatus: data.researchResourceStatus ?? null,
      totalNumberOfSubjects: data.totalNumberOfSubjects ?? null,
      inclusionCriteria: asArray(data.inclusionCriteria),
      publications: asArray(data.publications),
    };
  }

  static validate(data = {}) {
    const fields = this.fieldsOf(data);
    const errors = [];
    if (!isNonEmptyString(fields.name)) {
      errors.push('name é obrigatório para ResearchResource (1..1)');
    }
    const contacts = data.contactInformation;
    if (!Array.isArray(contacts) || contacts.length === 0 || !contacts.every(isContactInformation)) {
      errors.push('contactInformation é obrigatório para ResearchResource (1..*) e cada contato deve ter ao menos um valor preenchido');
    }
    const sexCategories = data.sexCategories;
    if (!Array.isArray(sexCategories) || sexCategories.length === 0 || !sexCategories.every(isNonEmptyString)) {
      errors.push('sexCategories é obrigatório para ResearchResource (1..*) e deve conter apenas códigos não vazios');
    }
    if (!Array.isArray(data.sampleTypes) || data.sampleTypes.length === 0) {
      errors.push('sampleTypes é obrigatório para ResearchResource (1..*)');
    }
    if (fields.url !== null && fields.url !== '') {
      try {
        // eslint-disable-next-line no-new
        new URL(String(fields.url));
      } catch (_) {
        errors.push('url deve ser uma URI válida');
      }
    }
    for (const field of [...CODE_ARRAYS, ...OTHER_ARRAYS]) {
      if (isPresent(data[field]) && !Array.isArray(data[field])) {
        errors.push(`${field} deve ser uma lista`);
      }
    }
    for (const field of CODE_ARRAYS) {
      if (Array.isArray(data[field]) && !data[field].every(isNonEmptyString)) {
        errors.push(`${field} deve conter apenas códigos não vazios`);
      }
    }
    for (const field of DECIMALS) {
      if (isPresent(data[field]) && !(typeof data[field] === 'number' && Number.isFinite(data[field]))) {
        errors.push(`${field} deve ser um número finito`);
      }
    }
    if (isPresent(data.totalNumberOfSubjects)
      && !(Number.isInteger(data.totalNumberOfSubjects) && data.totalNumberOfSubjects >= 0)) {
      errors.push('totalNumberOfSubjects deve ser um inteiro não negativo');
    }
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    return { ...this.fieldsOf(data), createdAt: new Date(), updatedAt: new Date() };
  }
}

module.exports = ResearchResourceModel;
