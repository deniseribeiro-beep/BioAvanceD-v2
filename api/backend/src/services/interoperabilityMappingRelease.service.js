// RF011 AC2, RULE-035 (#1322): the stored InteroperabilityMappingRelease
// rows (/api/interoperability-mapping-releases) and their FHIRProfileRegistry
// rows (/api/fhir-profiles). Existence only, as
// institutionalReferenceValidator.js checks its links. A key the payload does
// not carry (a PUT that does not send it) is not checked. A mappingReleaseId
// or namespace id that is not a non-empty string is skipped: the models
// require non-empty strings there and have already refused it, on POST and on
// PUT's merged row. The release model does not type-check
// supersedesReleaseId, so a carried non-null one that is not a non-empty
// string is refused here with 422, before the store is read.
//
// Not resolved: profileRegistryIds (a profile names its release, so the
// release is entered first and its profiles cannot resolve yet),
// canonicalModelReleaseId and terminologyReleaseIds.
const RELEASE_COLLECTION = 'interoperabilityMappingReleases';
const PROFILE_COLLECTION = 'fhirProfileRegistries';
const NAMESPACE_COLLECTION = 'identifierNamespaceRegistries';

function createReferenceError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

async function assertReleaseResolves(db, field, value) {
  if (!isNonEmptyString(value)) return;
  const release = await db.collection(RELEASE_COLLECTION).findOne({ interoperabilityMappingReleaseId: value });
  if (!release) {
    throw createReferenceError(`${field} ${value} não encontrado`);
  }
}

// RULE-035's approved namespaces: a stored IdentifierNamespaceRegistry row is
// an active one, since entry is activation there.
async function validateMappingReleaseReferences(db, payload = {}) {
  if (Object.prototype.hasOwnProperty.call(payload, 'supersedesReleaseId')
    && payload.supersedesReleaseId !== null && !isNonEmptyString(payload.supersedesReleaseId)) {
    const message = 'supersedesReleaseId deve ser um texto não vazio para InteroperabilityMappingRelease';
    const error = new Error(message);
    error.statusCode = 422;
    error.details = [message];
    throw error;
  }
  if (Array.isArray(payload.identifierNamespaceRegistryIds)) {
    for (const id of payload.identifierNamespaceRegistryIds) {
      if (!isNonEmptyString(id)) continue;
      const namespace = await db.collection(NAMESPACE_COLLECTION).findOne({ identifierNamespaceRegistryId: id });
      if (!namespace) {
        throw createReferenceError(`identifierNamespaceRegistryIds ${id} não encontrado`);
      }
    }
  }
  await assertReleaseResolves(db, 'supersedesReleaseId', payload.supersedesReleaseId);
}

async function validateProfileReferences(db, payload = {}) {
  await assertReleaseResolves(db, 'mappingReleaseId', payload.mappingReleaseId);
}

module.exports = {
  RELEASE_COLLECTION,
  PROFILE_COLLECTION,
  validateMappingReleaseReferences,
  validateProfileReferences,
};
