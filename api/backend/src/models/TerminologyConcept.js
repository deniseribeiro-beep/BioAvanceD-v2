/**
 * Modelo de validação e estrutura para TerminologyConcept (RF028).
 * Conceito canônico persistido a partir de uma ReferenceDatasetRelease
 * (dict-02_DICIONARIO.md P1X-0475..P1X-0492). Chave lógica versionada:
 * systemUri + code + version (plano integrado Fase 2, §7.3).
 *
 * Não confundir com o modelo legado `Terminology` (coleção `terminologies`,
 * usada pelo seed SPREC/RF022) — este é o modelo canônico da Fase 2,
 * vinculado obrigatoriamente a uma release versionada.
 */
const crypto = require('crypto');

const CONCEPT_STATUSES = ['active', 'inactive', 'deprecated', 'obsolete', 'retired'];

class TerminologyConceptModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.systemUri || typeof data.systemUri !== 'string') {
      errors.push('systemUri é obrigatório e deve ser string');
    }
    if (!data.code || typeof data.code !== 'string') {
      errors.push('code é obrigatório e deve ser string');
    }
    if (!data.version || typeof data.version !== 'string') {
      errors.push('version é obrigatório e deve ser string');
    }
    if (!data.display || typeof data.display !== 'string') {
      errors.push('display é obrigatório e deve ser string');
    }
    if (data.synonyms !== undefined && !Array.isArray(data.synonyms)) {
      errors.push('synonyms deve ser um array');
    }
    if (data.conceptStatus && !CONCEPT_STATUSES.includes(data.conceptStatus)) {
      errors.push(`conceptStatus deve ser um de: ${CONCEPT_STATUSES.join('|')}`);
    }
    if (data.semanticType !== undefined && !Array.isArray(data.semanticType)) {
      errors.push('semanticType deve ser um array');
    }
    if (!data.sourceRecordId || typeof data.sourceRecordId !== 'string') {
      errors.push('sourceRecordId é obrigatório e deve ser string');
    }
    if (!data.referenceDatasetReleaseId || typeof data.referenceDatasetReleaseId !== 'string') {
      errors.push('referenceDatasetReleaseId é obrigatório e deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const now = new Date();
    return {
      terminologyConceptId: data.terminologyConceptId || crypto.randomUUID(),
      systemUri: data.systemUri,
      code: data.code,
      version: data.version,
      display: data.display,
      language: data.language || 'en',
      definition: data.definition || null,
      synonyms: Array.isArray(data.synonyms) ? data.synonyms : [],
      conceptStatus: data.conceptStatus || 'active',
      semanticType: Array.isArray(data.semanticType) ? data.semanticType : [],
      properties: data.properties || null,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validTo: data.validTo ? new Date(data.validTo) : null,
      replacementCode: data.replacementCode || null,
      sourceRecordId: data.sourceRecordId,
      referenceDatasetReleaseId: data.referenceDatasetReleaseId,
      createdAt: now,
      updatedAt: now,
    };
  }
}

module.exports = TerminologyConceptModel;
module.exports.CONCEPT_STATUSES = CONCEPT_STATUSES;
