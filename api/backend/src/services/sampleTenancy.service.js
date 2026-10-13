/**
 * #1192: the organization a sample belongs to, for organization scoping.
 *
 * Sample.collectionSite is the recorded collection site (ELM-0128), and it
 * was also the tenancy key. Sample.organizationId separates the two: the
 * organization of record, the custodian (as StorageLocation.organizationId,
 * P1X-0103) until a CustodianshipAssignment says otherwise. See
 * docs/decisions/2026-10-11-sample-tenancy.md.
 *
 * Until src/scripts/migrateSampleOrganization.js has run, a stored sample may
 * have no organizationId, so every reader here falls back to collectionSite.
 */

const SAMPLE_ORGANIZATION_FIELD = 'organizationId';

function isPresent(value) {
  return value !== undefined && value !== null && value !== '';
}

function sampleOrganizationOf(sample) {
  if (!sample) return null;
  if (isPresent(sample.organizationId)) return String(sample.organizationId);
  if (isPresent(sample.collectionSite)) return String(sample.collectionSite);
  return null;
}

// Mirrors isRecordInOrganizationScope (rbac-assignment.service.js): a sample
// with no organization is out of scope for anyone who isn't 'global'.
function isSampleInOrganizationScope(sample, scope) {
  if (scope.scope === 'global') return true;
  const organizationId = sampleOrganizationOf(sample);
  return Boolean(organizationId) && scope.organizationIds.includes(organizationId);
}

// The fallback branch takes the unset set sampleOrganizationOf and the
// backfill fall back on: null, missing (`$in` with null matches a document
// without the field) or ''.
function sampleOrganizationScopeClause(scope) {
  if (!scope || scope.scope !== 'organization') return null;
  const ids = scope.organizationIds;
  return {
    $or: [
      { [SAMPLE_ORGANIZATION_FIELD]: { $in: ids } },
      { [SAMPLE_ORGANIZATION_FIELD]: { $in: [null, ''] }, collectionSite: { $in: ids } },
    ],
  };
}

// Appended under $and, so a top-level $or the query already has (a search,
// say) is kept as it is.
function applySampleOrganizationScope(query, scope) {
  const clause = sampleOrganizationScopeClause(scope);
  if (clause) {
    query.$and = Array.isArray(query.$and) ? [...query.$and, clause] : [clause];
  }
  return query;
}

module.exports = {
  SAMPLE_ORGANIZATION_FIELD,
  sampleOrganizationOf,
  isSampleInOrganizationScope,
  sampleOrganizationScopeClause,
  applySampleOrganizationScope,
};
