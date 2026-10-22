const { getCollection } = require('../utils/collectionResolver');

// RF007 AC5, V2E-0476 (#1321): an upload names the entities its DataFile is
// linked to, beside its parent. Each optional request field is checked for
// existence only, with no status gate, as workflowRunFileLinker.js does: the
// link records provenance and grants no use.
const LINK_FIELDS = [
  { field: 'consentId', entityType: 'Consent', find: (db, id) => getCollection(db, 'consents').findOne({ consentId: id }) },
  {
    field: 'approvalId',
    entityType: 'CollectionGovernanceApproval',
    find: (db, id) => getCollection(db, 'collectionGovernanceApprovals').findOne({ approvalId: id })
  },
  { field: 'studyId', entityType: 'Study', find: (db, id) => db.collection('studies').findOne({ studyId: id }) }
];

const MAX_ID_LENGTH = 128;

/**
 * @param {import('mongodb').Db} db
 * @param {object} body - the request fields (multer's req.body)
 * @param {{ entityType: string, entityId: string }} parentRef
 * @returns {Promise<{ refs: Array<{ entityType: string, entityId: string }>, errors: string[] }>}
 *   refs starts with parentRef, so it is never empty (1..*).
 */
async function resolveLinkedEntityRefs(db, body, parentRef) {
  const refs = [parentRef];
  const errors = [];

  for (const { field, entityType, find } of LINK_FIELDS) {
    const raw = body[field];
    if (raw === undefined || raw === '') continue;

    const id = typeof raw === 'string' ? raw.trim() : null;
    if (!id || id.length > MAX_ID_LENGTH) {
      errors.push(`${field} deve ser string não vazia`);
      continue;
    }

    const found = await find(db, id);
    if (!found) {
      errors.push(`${field} ${id} não encontrado`);
      continue;
    }
    refs.push({ entityType, entityId: id });
  }

  return { refs, errors };
}

module.exports = { resolveLinkedEntityRefs };
