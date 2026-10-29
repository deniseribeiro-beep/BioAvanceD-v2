/**
 * Modelo de validação e estrutura para Collection (RF004 AC#3, RF020 AC#3/AC#5, ELM-0039..0052)
 */

// V2E-0427 Collection.governanceRegime (1..1). RF004 AC2: research human
// material needs a collection whose regime is biobank or biorepository;
// RULE-001/002 name the two values.
const GOVERNANCE_REGIMES = ['biobank', 'biorepository'];
const CODEABLE_CONCEPT_ARRAY_FIELDS = [
  'sampleTypes',
  'datasetTypes',
  'diseaseScope',
  'inclusionCriteriaCategories',
  'miabisUseAccessConditions',
  'storageTemperatureCategories'
];

class CollectionModel {
  static validate(data) {
    const errors = [];

    if (!data.collectionId || typeof data.collectionId !== 'string' || data.collectionId.trim() === '') {
      errors.push('collectionId é obrigatório e deve ser string');
    }

    if (!data.collectionName || typeof data.collectionName !== 'string' || data.collectionName.trim() === '') {
      errors.push('collectionName é obrigatório e deve ser string');
    }

    if (!GOVERNANCE_REGIMES.includes(data.governanceRegime)) {
      errors.push(`governanceRegime é obrigatório e deve ser um de: ${GOVERNANCE_REGIMES.join(', ')}`);
    }

    for (const field of CODEABLE_CONCEPT_ARRAY_FIELDS) {
      if (data[field] !== undefined && data[field] !== null && !Array.isArray(data[field])) {
        errors.push(`${field} deve ser uma lista`);
      }
    }

    if (
      data.relatedPublications !== undefined &&
      data.relatedPublications !== null &&
      !Array.isArray(data.relatedPublications)
    ) {
      errors.push('relatedPublications deve ser uma lista');
    }

    if (data.exclusionCriteria !== undefined && data.exclusionCriteria !== null && typeof data.exclusionCriteria !== 'string') {
      errors.push('exclusionCriteria deve ser string');
    }

    for (const field of ['participantCount', 'sampleCount']) {
      if (data[field] !== undefined && data[field] !== null) {
        const value = Number(data[field]);
        if (!Number.isInteger(value) || value < 0) {
          errors.push(`${field} deve ser um inteiro não negativo`);
        }
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data) {
    const document = {
      collectionId: data.collectionId,
      collectionName: data.collectionName,
      collectionStatus: data.collectionStatus || 'active',
      governanceRegime: data.governanceRegime ?? null,
      exclusionCriteria: data.exclusionCriteria ?? null,
      participantCount: data.participantCount !== undefined && data.participantCount !== null ? Number(data.participantCount) : null,
      sampleCount: data.sampleCount !== undefined && data.sampleCount !== null ? Number(data.sampleCount) : null,
      relatedPublications: Array.isArray(data.relatedPublications) ? data.relatedPublications : [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    for (const field of CODEABLE_CONCEPT_ARRAY_FIELDS) {
      document[field] = Array.isArray(data[field]) ? data[field] : [];
    }

    return document;
  }
}

module.exports = CollectionModel;
module.exports.CODEABLE_CONCEPT_ARRAY_FIELDS = CODEABLE_CONCEPT_ARRAY_FIELDS;
module.exports.GOVERNANCE_REGIMES = GOVERNANCE_REGIMES;
