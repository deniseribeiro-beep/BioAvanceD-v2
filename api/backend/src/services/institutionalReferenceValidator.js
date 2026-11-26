const { getCollection } = require('../utils/collectionResolver');

// RF020 AC1 (#1322): a Biobank's legalEntityId (ELM-0035) and a Network's
// juristicPerson (P1X-0005) are Organization References. Existence only, as
// assayReferenceValidator.js checks its links. A key the payload does not
// carry (a PUT that does not send it) is not checked. networkMembers is not
// resolved: a member may be a Biobank or a Network.

function createReferenceError(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

async function assertOrganizationResolves(db, field, value) {
  if (!isNonEmptyString(value)) return;
  const organization = await getCollection(db, 'organizations').findOne({ organizationId: String(value) });
  if (!organization) {
    throw createReferenceError(`${field} ${value} não encontrado`);
  }
}

async function validateBiobankReferences(db, payload) {
  await assertOrganizationResolves(db, 'legalEntityId', payload.legalEntityId);
}

async function validateNetworkReferences(db, payload) {
  await assertOrganizationResolves(db, 'juristicPerson', payload.juristicPerson);
}

// RNF008 AC3 (#1496): a ResearchResourceCollection and a
// ResearchResourceBiobank name an existing ResearchResource and an existing
// Collection or Biobank. These collections have no CANONICAL_COLLECTIONS
// entry, so they are read by name, each with its own static filter key.
async function assertResolves(field, value, lookup) {
  if (!isNonEmptyString(value)) return;
  const found = await lookup(String(value));
  if (!found) {
    throw createReferenceError(`${field} ${value} não encontrado`);
  }
}

function assertResearchResourceResolves(db, value) {
  return assertResolves('researchResourceId', value,
    (researchResourceId) => db.collection('researchResources').findOne({ researchResourceId }));
}

async function validateResearchResourceCollectionReferences(db, payload) {
  await assertResearchResourceResolves(db, payload.researchResourceId);
  await assertResolves('collectionId', payload.collectionId,
    (collectionId) => db.collection('collections').findOne({ collectionId }));
}

async function validateResearchResourceBiobankReferences(db, payload) {
  await assertResearchResourceResolves(db, payload.researchResourceId);
  await assertResolves('biobankId', payload.biobankId,
    (biobankId) => db.collection('biobanks').findOne({ biobankId }));
}

module.exports = {
  validateBiobankReferences,
  validateNetworkReferences,
  validateResearchResourceCollectionReferences,
  validateResearchResourceBiobankReferences,
};
