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

const ORPHA_SYSTEM = 'http://www.orpha.net';
const stripOrpha = (value) => String(value || '').trim().replace(/^ORPHA:/i, '');

// The rows associating an analyte with an ORPHA disease, for /suggest's local
// fallback (#1206). The query only narrows: MongoDB matches a scalar against
// an array field, so `system: ['DOI']` or a systemUri array would come back
// too. A row is kept only when the model's own check passes and one of its
// conditions is that ORPHA code with string fields.
async function findAssociationsForOrpha(db, orphaCode) {
  const normalized = stripOrpha(orphaCode);
  if (!normalized) return [];

  const rows = await db.collection(COLLECTION).find({
    associatedCondition: {
      $elemMatch: { systemUri: ORPHA_SYSTEM, code: { $in: [normalized, `ORPHA:${normalized}`] } },
    },
  }).limit(100).toArray();

  return rows.filter((row) => BiomarkerAssociationModel.validate(row).isValid
    && row.associatedCondition.some((entry) => typeof entry.code === 'string'
      && entry.systemUri === ORPHA_SYSTEM
      && stripOrpha(entry.code) === normalized));
}

module.exports = { COLLECTION, validateBiomarkerAssociationReferences, findAssociationsForOrpha };
