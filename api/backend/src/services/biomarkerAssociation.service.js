const BiomarkerAssociationModel = require('../models/BiomarkerAssociation');

// ELM-0275..0285 (#1206): the stored BiomarkerAssociation rows
// (/api/biomarker-associations).
const COLLECTION = 'biomarkerAssociations';

// The PUT re-validates nothing else, so this re-checks the required fields
// the payload carries: an edit cannot empty evidenceReferences or
// associatedCondition, blank contextOfUse or set an unknown biomarkerRole.
// The POST passes through it again after model.validate, harmlessly. A
// passing biomarkerRole is written back normalised, since the PUT $sets this
// same object. db is unused: nothing here is resolved against the store.
async function validateBiomarkerAssociationReferences(db, payload = {}) {
  const presentKeys = BiomarkerAssociationModel.REQUIRED
    .filter((key) => Object.prototype.hasOwnProperty.call(payload, key));
  if (presentKeys.length === 0) return;
  const fields = BiomarkerAssociationModel.fieldsOf(payload);
  const errors = BiomarkerAssociationModel.fieldErrors(fields, presentKeys);
  if (errors.length > 0) {
    const error = new Error(errors.join(', '));
    error.statusCode = 422;
    throw error;
  }
  if (presentKeys.includes('biomarkerRole')) payload.biomarkerRole = fields.biomarkerRole;
}

module.exports = { COLLECTION, validateBiomarkerAssociationReferences };
