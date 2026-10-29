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

module.exports = { validateBiobankReferences, validateNetworkReferences };
