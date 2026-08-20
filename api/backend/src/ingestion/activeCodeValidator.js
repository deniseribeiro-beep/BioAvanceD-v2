/**
 * RF029 AC 4 ("Utilizar somente códigos pertencentes a releases de
 * referência ativas ou registrar revisão controlada quando permitido",
 * #669): nothing before this cross-checked an *operational* write's coded
 * fields (SPREC code, ICD code, etc.) against RF028's
 * TerminologyConcept/ReferenceDatasetRelease at ingestion time — RF028's own
 * validity machinery (reference-imports/pipeline.js) only guards its own
 * reference-import pipeline's inserts, not a downstream entity referencing
 * an already-promoted code.
 */
const { CANONICAL_COLLECTIONS } = require('../config/collections');

/**
 * Resolves one systemUri+code(+version) against TerminologyConcept, then its
 * owning ReferenceDatasetRelease. `version` omitted matches the newest
 * concept row for that systemUri+code (TerminologyConcept.create has no
 * "latest" flag of its own — validFrom descending is the best available
 * ordering; ties are acceptable since a real duplicate would be a data bug
 * upstream, not this validator's concern).
 */
async function checkActiveCode(db, { systemUri, code, version = null }) {
  if (!systemUri || !code) {
    throw new Error('checkActiveCode: systemUri e code são obrigatórios');
  }

  const conceptFilter = { systemUri, code };
  if (version) conceptFilter.version = version;

  const concepts = db.collection(CANONICAL_COLLECTIONS.terminologyConcepts);
  const concept = await concepts.findOne(conceptFilter, { sort: { validFrom: -1 } });

  if (!concept) {
    return { active: false, status: 'unknown', concept: null, release: null };
  }

  if (concept.conceptStatus && concept.conceptStatus !== 'active') {
    return { active: false, status: 'inactive_concept', concept, release: null };
  }

  const releases = db.collection(CANONICAL_COLLECTIONS.referenceDatasetReleases);
  const release = await releases.findOne({ referenceDatasetReleaseId: concept.referenceDatasetReleaseId });

  if (!release || release.releaseStatus !== 'active') {
    return { active: false, status: 'inactive_release', concept, release: release || null };
  }

  return { active: true, status: 'active', concept, release };
}

/**
 * Batch form for a payload carrying several coded fields at once. An entry
 * with `allowControlledReview: true` is AC 4's "ou registrar revisão
 * controlada quando permitido" escape hatch — it still reports the check
 * result (so a caller can act on it) but doesn't turn into a hard violation;
 * recording the review itself is an entity-slice concern (#670-673), not
 * this foundation's.
 */
async function validateActiveCodes(db, codes = []) {
  const violations = [];
  const results = [];

  for (const entry of codes) {
    const { systemUri, code, version = null, label, allowControlledReview = false } = entry || {};
    if (!systemUri || !code) continue; // presence is a contract-schema concern, not this validator's

    const result = await checkActiveCode(db, { systemUri, code, version });
    results.push({ systemUri, code, version, label, ...result });

    if (!result.active && !allowControlledReview) {
      violations.push({
        code: 'INACTIVE_OR_UNKNOWN_CODE',
        field: label || `${systemUri}|${code}`,
        message: `Código não pertence a uma release de referência ativa: ${label || code} (${systemUri}) — status: ${result.status}`,
      });
    }
  }

  return { valid: violations.length === 0, violations, results };
}

module.exports = {
  checkActiveCode,
  validateActiveCodes,
};
