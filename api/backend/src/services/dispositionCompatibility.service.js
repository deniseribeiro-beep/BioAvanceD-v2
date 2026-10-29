const { getCollection } = require('../utils/collectionResolver');
const { findSampleByAnyId } = require('../utils/sampleLookup');
const { isInForce } = require('../models/CollectionGovernanceApproval');
const custodianship = require('./custodianship.service');

// #1363 (RF026 AC6, RNF022 C4): a specimen's destruction or transfer is
// executed only when it is compatible with consent, ethics and custody. The
// legal hold, the fourth condition AC6 names, is checked by the execution
// itself (dispositionAction.service.js).
//
// The rules, per affected specimen:
// - custody: an assignment holds the specimen now and its authorization is
//   in force, the rule loading on the physical chain already applies;
// - ethics: the ethics approval the specimen's collection names is in force;
// - consent, for a transfer only: the participant's consent is active (or the
//   specimen's consent was signed on paper or attached externally, as the
//   quarantine release accepts), and that consent does not deny sharing with
//   researchers. [inference] A destruction is what a revoked or withdrawn
//   consent asks for, so no consent state makes one incompatible.

const SPECIMEN_ENTITY_TYPES = ['Specimen', 'Sample'];
const GUARDED_ACTIONS = ['destroy', 'transfer'];
const SHARING_PERMISSION = 'compartilhamento_pesquisadores';
const CONSENT_STATUSES_SATISFYING = ['SIGNED', 'EXTERNAL_ATTACHED'];

function isGuarded(action) {
  return SPECIMEN_ENTITY_TYPES.includes(action?.entityType) && GUARDED_ACTIONS.includes(action?.dispositionAction);
}

async function ethicsRefusal(db, sample, at) {
  if (!sample.collectionId) return null;
  // `collections` has no resolver key; custody reads it the same way.
  const collection = await db.collection('collections').findOne({ collectionId: String(sample.collectionId) });
  const ethicsApprovalId = collection?.governanceContext?.ethicsApprovalId;
  if (!ethicsApprovalId) return null;
  const approval = await (await getCollection(db, 'collectionGovernanceApprovals')).findOne({ approvalId: String(ethicsApprovalId) });
  return isInForce(approval, at) ? null : `Aprovação ética ${ethicsApprovalId} da coleção ${sample.collectionId} não está vigente`;
}

async function sharingConsentRefusal(db, sample) {
  if (!sample.participantId) return `Espécime ${sample.specimenId} sem participante: o consentimento para transferência não pode ser verificado`;
  const consent = await (await getCollection(db, 'consents')).findOne(
    { participantId: sample.participantId, status: 'ACTIVE' },
    { sort: { signedAt: -1, createdAt: -1 } }
  );
  if (!consent) {
    return CONSENT_STATUSES_SATISFYING.includes(String(sample.consentStatus || '').toUpperCase())
      ? null
      : `Consentimento do participante de ${sample.specimenId} não está ativo`;
  }
  const consentId = consent.consentId || String(consent._id);
  const denial = await (await getCollection(db, 'consentPermissions')).findOne({ consentId, permissionCode: SHARING_PERMISSION, decision: 'deny' });
  return denial ? `Consentimento ${consentId} nega o compartilhamento com pesquisadores` : null;
}

/**
 * The rules a guarded disposition breaks, one row per specimen and rule:
 * `{ specimenId, rule, message }`. Empty when the disposition is compatible
 * or is not a specimen's destruction or transfer.
 */
async function incompatibilitiesOf(db, action, at = new Date()) {
  if (!isGuarded(action)) return [];
  const samples = await getCollection(db, 'samples');
  const found = [];
  for (const recordId of action.affectedRecordIds || []) {
    const sample = await findSampleByAnyId(samples, recordId);
    if (!sample) {
      found.push({ specimenId: recordId, rule: 'specimen_not_found', message: `Espécime ${recordId} não encontrado` });
      continue;
    }
    const specimenId = sample.specimenId || recordId;
    const custody = await custodianship.operabilityRefusal(db, specimenId, at);
    if (custody) found.push({ specimenId, rule: 'custody', message: custody });
    const ethics = await ethicsRefusal(db, sample, at);
    if (ethics) found.push({ specimenId, rule: 'ethics', message: ethics });
    if (action.dispositionAction === 'transfer') {
      const consent = await sharingConsentRefusal(db, sample);
      if (consent) found.push({ specimenId, rule: 'consent', message: consent });
    }
  }
  return found;
}

module.exports = { incompatibilitiesOf, isGuarded, SHARING_PERMISSION };
