/**
 * RF029 AC 3 ("Exigir provenance, origem, timestamps, ator e finalidade
 * conforme o tipo de dado", #669): a shared envelope every ingestionGateway
 * call attaches, instead of each entity slice inventing its own provenance
 * shape. Field names deliberately reuse dict-02_DICIONARIO.md's BaseRecord
 * ("Governança transversal", ELM-0001..ELM-0023) vocabulary where it already
 * defines the concept: sourceSystem (origem, ELM-0010), createdBy (ator,
 * ELM-0007 — "Reference" shaped, e.g. "Actor/<id>", matching the
 * resolvedBy convention reference-imports/quarantine.js already uses), and
 * retrievedAt (timestamps, ELM-0013). `purpose` (finalidade) has no single
 * BaseRecord field — dict-02 only defines it per-entity (Consent.
 * authorizedPurposes, AccessRequest.requestedPurpose) — so it's an
 * ingestion-specific addition here, not a BaseRecord field name.
 */
const REQUIRED_FIELDS = ['sourceSystem', 'createdBy', 'retrievedAt', 'purpose'];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildProvenanceEnvelope(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    sourceSystem: normalizeString(source.sourceSystem) || null,
    createdBy: normalizeString(source.createdBy) || null,
    retrievedAt: source.retrievedAt ? new Date(source.retrievedAt) : null,
    purpose: normalizeString(source.purpose) || null,
    sourceRecordId: normalizeString(source.sourceRecordId) || null,
  };
}

/**
 * Returns violations rather than throwing — the gateway quarantines an
 * invalid/missing envelope (AC 6), it never silently defaults one in.
 */
function validateProvenanceEnvelope(rawEnvelope) {
  const envelope = buildProvenanceEnvelope(rawEnvelope);
  const violations = [];

  for (const field of REQUIRED_FIELDS) {
    const value = envelope[field];
    const missing = field === 'retrievedAt' ? !(value instanceof Date) || Number.isNaN(value.getTime()) : !value;
    if (missing) {
      violations.push({
        code: 'PROVENANCE_FIELD_MISSING',
        field: `provenance.${field}`,
        message: `provenance.${field} é obrigatório`,
      });
    }
  }

  return { valid: violations.length === 0, violations, envelope };
}

module.exports = {
  buildProvenanceEnvelope,
  validateProvenanceEnvelope,
  REQUIRED_FIELDS,
};
