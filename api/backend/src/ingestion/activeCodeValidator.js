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
const { getCanonicalCollection } = require('../config/canonicalEntityCollections.v2');

function buildResult(concept, release) {
  if (!concept) {
    return { active: false, status: 'unknown', concept: null, release: null };
  }
  if (concept.conceptStatus && concept.conceptStatus !== 'active') {
    return { active: false, status: 'inactive_concept', concept, release: null };
  }
  if (!release || release.releaseStatus !== 'active') {
    return { active: false, status: 'inactive_release', concept, release: release || null };
  }
  return { active: true, status: 'active', concept, release };
}

async function resolveRelease(releases, concept) {
  if (!concept) return null;
  return releases.findOne({ referenceDatasetReleaseId: concept.referenceDatasetReleaseId });
}

/**
 * Resolves one systemUri+code(+version) against TerminologyConcept, then its
 * owning ReferenceDatasetRelease.
 *
 * #676: `version` omitted used to pick the concept row with the newest
 * `validFrom` — but no reference-import normalizer (reference-data/
 * reference-imports/normalize*.js) ever sets `validFrom`, so that ordering
 * never actually discriminated between rows a re-import's superseded
 * release left behind and the current active release's own rows; it
 * silently fell back to insertion order, which can surface the superseded
 * row. Resolved instead via release status: `promote()` in
 * reference-imports/pipeline.js guarantees at most one `releaseStatus:
 * 'active'` release per `datasetCode`, so filtering candidate concepts down
 * to the one whose own release is active is unambiguous by construction.
 * More than one active-release match is a genuine upstream data bug (two
 * releases active at once for the same code) — fail closed rather than
 * silently pick one.
 */
async function checkActiveCode(db, { systemUri, code, version = null }) {
  if (!systemUri || !code) {
    throw new Error('checkActiveCode: systemUri e code são obrigatórios');
  }

  const concepts = getCanonicalCollection(db, 'TerminologyConcept');
  const releases = getCanonicalCollection(db, 'ReferenceDatasetRelease');

  if (version) {
    const concept = await concepts.findOne({ systemUri, code, version });
    return buildResult(concept, await resolveRelease(releases, concept));
  }

  const candidates = await concepts.find({ systemUri, code }).toArray();
  if (candidates.length === 0) {
    return buildResult(null, null);
  }

  const withReleases = await Promise.all(
    candidates.map(async (concept) => ({ concept, release: await resolveRelease(releases, concept) }))
  );
  const activeMatches = withReleases.filter(({ release }) => release && release.releaseStatus === 'active');

  if (activeMatches.length > 1) {
    return { active: false, status: 'ambiguous_active_release', concept: null, release: null };
  }
  if (activeMatches.length === 1) {
    return buildResult(activeMatches[0].concept, activeMatches[0].release);
  }

  return buildResult(withReleases[0].concept, withReleases[0].release);
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
