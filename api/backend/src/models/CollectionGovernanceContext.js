/**
 * The two governance contexts a collection carries, exactly one matching its
 * governanceRegime (RULE-001/002, REL-0168; RF004 AC3-AC5, RF020 AC2,
 * RF021 AC3):
 *
 * - BiorepositoryContext (V2E-0076..0087): the study, protocol and version,
 *   CAAE, institution, investigator, ethics approval and validity of a
 *   biorepository collection.
 * - BiobankGovernanceContext (V2E-0088..0096): the broad purpose, policy,
 *   access committee, custodian and future-use conditions of a biobank.
 *
 * The v2.0.0 synthetic examples store the context embedded on the Collection
 * document as `governanceContext`, which is where this model puts it.
 */
const crypto = require('crypto');
const { validatePeriod, isNonEmptyString, validDate } = require('./CollectionGovernanceApproval');

// ENUM-0043..0046, Consent.consentModel: the modalities a biobank policy
// may admit (V2E-0095).
const CONSENT_MODELS = ['specific', 'broad', 'tiered', 'dynamic'];

// V2E-0096's vocabulary cell names `always` and its example
// `when_required_by_policy`; no other value is given.
const ETHICS_REVIEW_RULES = ['always', 'when_required_by_policy'];

const BIOREPOSITORY_FIELDS = [
  'studyId', 'protocolId', 'protocolVersion', 'caae', 'responsibleOrganizationId',
  'responsibleInvestigatorId', 'ethicsApprovalId', 'validityPeriod', 'plannedEndDate', 'closureCondition',
];
const BIOBANK_FIELDS = [
  'broadPurpose', 'governancePolicyId', 'accessCommitteeId', 'institutionalCustodianId',
  'futureUseConditions', 'applicableConsentModel', 'newEthicsReviewRule',
];

// The context identifier each regime's context carries.
const CONTEXT_ID_FIELD = {
  biorepository: 'biorepositoryContextId',
  biobank: 'biobankGovernanceContextId',
};

function isCodeableConcept(value) {
  if (isNonEmptyString(value)) return true;
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (isNonEmptyString(value.code) || isNonEmptyString(value.text));
}

function present(value) {
  return value !== undefined && value !== null && value !== '';
}

function validateBiorepository(ctx) {
  const errors = [];
  for (const field of ['studyId', 'protocolId', 'protocolVersion', 'caae', 'responsibleOrganizationId', 'responsibleInvestigatorId', 'ethicsApprovalId']) {
    if (!isNonEmptyString(ctx[field])) errors.push(`${field} é obrigatório para biorrepositório`);
  }
  errors.push(...validatePeriod(ctx.validityPeriod, 'validityPeriod'));
  // RF021 AC3: "prazo ou condição de encerramento" -- V2E-0086/0087 are each
  // conditional, and the requirement asks for one of them.
  if (present(ctx.plannedEndDate) && !validDate(ctx.plannedEndDate)) {
    errors.push('plannedEndDate deve ser uma data ISO 8601');
  }
  if (present(ctx.closureCondition) && !isNonEmptyString(ctx.closureCondition)) {
    errors.push('closureCondition deve ser string');
  }
  if (!present(ctx.plannedEndDate) && !present(ctx.closureCondition)) {
    errors.push('biorrepositório exige plannedEndDate ou closureCondition (RF021 AC3)');
  }
  return errors;
}

function validateBiobank(ctx) {
  const errors = [];
  if (!isCodeableConcept(ctx.broadPurpose)) errors.push('broadPurpose é obrigatório para biobanco');
  for (const field of ['governancePolicyId', 'accessCommitteeId', 'institutionalCustodianId']) {
    if (!isNonEmptyString(ctx[field])) errors.push(`${field} é obrigatório para biobanco`);
  }
  if (!Array.isArray(ctx.futureUseConditions) || ctx.futureUseConditions.length === 0
    || !ctx.futureUseConditions.every(isCodeableConcept)) {
    errors.push('futureUseConditions é obrigatório para biobanco (lista não vazia)');
  }
  if (!Array.isArray(ctx.applicableConsentModel) || ctx.applicableConsentModel.length === 0
    || !ctx.applicableConsentModel.every((m) => CONSENT_MODELS.includes(m))) {
    errors.push(`applicableConsentModel é obrigatório para biobanco, valores em: ${CONSENT_MODELS.join(', ')}`);
  }
  if (!ETHICS_REVIEW_RULES.includes(ctx.newEthicsReviewRule)) {
    errors.push(`newEthicsReviewRule deve ser um de: ${ETHICS_REVIEW_RULES.join(', ')}`);
  }
  return errors;
}

class CollectionGovernanceContextModel {
  /** BiorepositoryContext's canonical element names (conformance test). */
  static biorepositoryFieldsOf(data = {}) {
    return {
      biorepositoryContextId: data.biorepositoryContextId,
      collectionId: data.collectionId,
      studyId: data.studyId,
      protocolId: data.protocolId,
      protocolVersion: data.protocolVersion,
      caae: data.caae,
      responsibleOrganizationId: data.responsibleOrganizationId,
      responsibleInvestigatorId: data.responsibleInvestigatorId,
      ethicsApprovalId: data.ethicsApprovalId,
      validityPeriod: data.validityPeriod,
      plannedEndDate: data.plannedEndDate,
      closureCondition: data.closureCondition,
    };
  }

  /** BiobankGovernanceContext's canonical element names (conformance test). */
  static biobankFieldsOf(data = {}) {
    return {
      biobankGovernanceContextId: data.biobankGovernanceContextId,
      collectionId: data.collectionId,
      broadPurpose: data.broadPurpose,
      governancePolicyId: data.governancePolicyId,
      accessCommitteeId: data.accessCommitteeId,
      institutionalCustodianId: data.institutionalCustodianId,
      futureUseConditions: data.futureUseConditions,
      applicableConsentModel: data.applicableConsentModel,
      newEthicsReviewRule: data.newEthicsReviewRule,
    };
  }

  /**
   * RULE-001/002: the context must be the one the regime names, carrying its
   * required fields and none of the other regime's.
   */
  static validate(regime, ctx) {
    if (!CONTEXT_ID_FIELD[regime]) {
      return { isValid: false, errors: ['governanceRegime deve ser biobank ou biorepository'] };
    }
    if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) {
      return { isValid: false, errors: ['governanceContext é obrigatório'] };
    }
    const foreign = (regime === 'biorepository' ? BIOBANK_FIELDS : BIOREPOSITORY_FIELDS).filter((f) => present(ctx[f]));
    const errors = foreign.length > 0
      ? [`contexto de ${regime} não pode conter campos do outro regime: ${foreign.join(', ')} (RULE-001/002)`]
      : [];
    errors.push(...(regime === 'biorepository' ? validateBiorepository(ctx) : validateBiobank(ctx)));
    return { isValid: errors.length === 0, errors };
  }

  /** The stored context: only the regime's own fields, with its id. */
  static create(regime, collectionId, ctx) {
    const fieldsOf = regime === 'biorepository'
      ? CollectionGovernanceContextModel.biorepositoryFieldsOf
      : CollectionGovernanceContextModel.biobankFieldsOf;
    const stored = fieldsOf({ ...ctx, collectionId, [CONTEXT_ID_FIELD[regime]]: crypto.randomUUID() });
    if (regime === 'biorepository') {
      stored.validityPeriod = { start: ctx.validityPeriod.start, end: ctx.validityPeriod.end || null };
      stored.plannedEndDate = ctx.plannedEndDate || null;
      stored.closureCondition = ctx.closureCondition || null;
    }
    return stored;
  }

  /** RULE-001/002 read back: does a stored context match the regime? */
  static matchesRegime(regime, ctx) {
    return Boolean(ctx && CONTEXT_ID_FIELD[regime] && isNonEmptyString(ctx[CONTEXT_ID_FIELD[regime]]));
  }
}

module.exports = CollectionGovernanceContextModel;
module.exports.CONSENT_MODELS = CONSENT_MODELS;
module.exports.ETHICS_REVIEW_RULES = ETHICS_REVIEW_RULES;
module.exports.CONTEXT_ID_FIELD = CONTEXT_ID_FIELD;
module.exports.BIOREPOSITORY_FIELDS = BIOREPOSITORY_FIELDS;
module.exports.BIOBANK_FIELDS = BIOBANK_FIELDS;
