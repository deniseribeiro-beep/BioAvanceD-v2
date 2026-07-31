/**
 * Modelo de validação e estrutura para TerminologyRelation (RF028).
 * Relação versionada entre dois TerminologyConcept (dict-02_DICIONARIO.md
 * P1X-0493..P1X-0506). Chave lógica versionada: sourceConceptId +
 * relationType + targetConceptId + version (plano integrado Fase 2, §7.3).
 * Mapeamentos não são equivalências automáticas — o tipo e a fonte devem
 * ser explícitos.
 */
const crypto = require('crypto');

const RELATION_TYPES = [
  'is_a',
  'part_of',
  'equivalent_to',
  'maps_to',
  'exact_match',
  'broader_than',
  'narrower_than',
  'replaced_by',
  'associated_with',
  'phenotype_of',
  'gene_associated_with',
];
const RELATION_STATUSES = ['active', 'inactive', 'deprecated', 'rejected'];

class TerminologyRelationModel {
  static validate(data = {}) {
    const errors = [];

    if (!data.sourceConceptId || typeof data.sourceConceptId !== 'string') {
      errors.push('sourceConceptId é obrigatório e deve ser string');
    }
    if (!data.targetConceptId || typeof data.targetConceptId !== 'string') {
      errors.push('targetConceptId é obrigatório e deve ser string');
    }
    if (!data.relationType || !RELATION_TYPES.includes(data.relationType)) {
      errors.push(`relationType é obrigatório e deve ser um de: ${RELATION_TYPES.join('|')}`);
    }
    if (!data.relationVersion || typeof data.relationVersion !== 'string') {
      errors.push('relationVersion é obrigatório e deve ser string');
    }
    if (data.relationStatus && !RELATION_STATUSES.includes(data.relationStatus)) {
      errors.push(`relationStatus deve ser um de: ${RELATION_STATUSES.join('|')}`);
    }
    if (data.evidenceReferences !== undefined && !Array.isArray(data.evidenceReferences)) {
      errors.push('evidenceReferences deve ser um array');
    }
    if (!data.referenceDatasetReleaseId || typeof data.referenceDatasetReleaseId !== 'string') {
      errors.push('referenceDatasetReleaseId é obrigatório e deve ser string');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const now = new Date();
    return {
      terminologyRelationId: data.terminologyRelationId || crypto.randomUUID(),
      sourceConceptId: data.sourceConceptId,
      targetConceptId: data.targetConceptId,
      relationType: data.relationType,
      relationSystem: data.relationSystem || null,
      relationVersion: data.relationVersion,
      relationStatus: data.relationStatus || 'active',
      evidenceLevel: data.evidenceLevel || null,
      evidenceReferences: Array.isArray(data.evidenceReferences) ? data.evidenceReferences : [],
      relationProperties: data.relationProperties || null,
      referenceDatasetReleaseId: data.referenceDatasetReleaseId,
      sourceRecordId: data.sourceRecordId || null,
      createdAt: now,
      updatedAt: now,
    };
  }
}

module.exports = TerminologyRelationModel;
module.exports.RELATION_TYPES = RELATION_TYPES;
module.exports.RELATION_STATUSES = RELATION_STATUSES;
