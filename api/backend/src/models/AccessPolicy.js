/**
 * AccessPolicy (RF024 AC2/AC3, RNF008 AC4/AC5, POL-001; dict v2.0.0
 * P1X-0120..0127, V2E-0481..0485): a versioned, computable access policy.
 * A version is immutable once stored; a change is a new version of the same
 * accessPolicyId with a higher policyVersion (POL-001 "Versionar
 * AccessPolicy"). The evaluation below is pure, so the service and its unit
 * tests exercise every branch without I/O.
 */
const crypto = require('crypto');

// P1X-0125's example is `permit`; RF024 AC3 and RNF008 AC5 name the set.
const DECISION_EFFECTS = ['permit', 'deny', 'review_required'];

// P1X-0126 "Regra computável ou referência ao motor de políticas": the rule
// is a reference to how this engine combines the policy's conditions.
const RULE_EXPRESSIONS = ['all-conditions', 'any-condition'];

// V2E-0484's example, `[{"consent":"compatible"}]`: each condition is an
// object of fact -> required value, and every key of one condition must hold.
// The facts are what an access request evaluation knows.
const CONDITION_FACTS = {
  consent: ['compatible', 'incompatible'],
  duo: ['compatible', 'incompatible', 'not_requested'],
  study: ['active', 'inactive'],
  organizationId: null,
  studyId: null,
  protocolId: null,
  collectionId: null,
  biobankId: null,
  requestedPurpose: null,
  duoCode: null,
};

// An access request's item types, as the canonical entity names a policy's
// resourceScopes use (V2E-0483's example: [Specimen,DataFile]).
const ITEM_TYPE_ENTITIES = { specimen: 'Specimen', dataset: 'Dataset', file: 'DataFile' };

// RF024's primary actor is the Pesquisador; V2E-0481's example is [researcher].
const ACCESS_REQUEST_ROLE = 'researcher';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v.trim() !== '');
}

function validDate(value) {
  return value !== undefined && value !== null && !Number.isNaN(new Date(value).getTime());
}

class AccessPolicyModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      accessPolicyId: data.accessPolicyId,
      policyName: data.policyName,
      policyVersion: data.policyVersion,
      applicableEntityTypes: data.applicableEntityTypes,
      purposeCodes: data.purposeCodes,
      decisionEffect: data.decisionEffect,
      ruleExpression: data.ruleExpression,
      effectivePeriod: data.effectivePeriod,
      roleCodes: data.roleCodes,
      organizationScopeIds: data.organizationScopeIds,
      resourceScopes: data.resourceScopes,
      conditions: data.conditions,
      decisionReasonsRequired: data.decisionReasonsRequired,
    };
  }

  static validate(data = {}) {
    const errors = [];

    if (!data.policyName || typeof data.policyName !== 'string' || !data.policyName.trim()) {
      errors.push('policyName é obrigatório e deve ser string');
    }
    if (typeof data.policyVersion !== 'string' || !SEMVER.test(data.policyVersion)) {
      errors.push('policyVersion é obrigatório e deve ser SemVer (MAJOR.MINOR.PATCH)');
    }
    for (const field of ['applicableEntityTypes', 'roleCodes', 'organizationScopeIds', 'resourceScopes']) {
      if (!isNonEmptyStringArray(data[field])) {
        errors.push(`${field} é obrigatório e deve ser um array não vazio de strings`);
      }
    }
    if (data.purposeCodes !== undefined && data.purposeCodes !== null && !(Array.isArray(data.purposeCodes)
      && data.purposeCodes.every((v) => typeof v === 'string' && v.trim() !== ''))) {
      errors.push('purposeCodes deve ser um array de strings quando informado');
    }
    if (!DECISION_EFFECTS.includes(data.decisionEffect)) {
      errors.push(`decisionEffect deve ser um de: ${DECISION_EFFECTS.join(', ')}`);
    }
    if (!RULE_EXPRESSIONS.includes(data.ruleExpression)) {
      errors.push(`ruleExpression deve ser um de: ${RULE_EXPRESSIONS.join(', ')}`);
    }
    if (!data.effectivePeriod || !validDate(data.effectivePeriod.start)) {
      errors.push('effectivePeriod.start é obrigatório e deve ser uma data válida');
    } else if (data.effectivePeriod.end !== undefined && data.effectivePeriod.end !== null) {
      if (!validDate(data.effectivePeriod.end)) {
        errors.push('effectivePeriod.end deve ser uma data válida quando informado');
      } else if (new Date(data.effectivePeriod.end) <= new Date(data.effectivePeriod.start)) {
        errors.push('effectivePeriod.end deve ser posterior a effectivePeriod.start');
      }
    }
    if (!Array.isArray(data.conditions) || data.conditions.length === 0) {
      errors.push('conditions é obrigatório e deve ser um array não vazio');
    } else {
      data.conditions.forEach((condition, index) => {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition) || Object.keys(condition).length === 0) {
          errors.push(`conditions[${index}] deve ser um objeto não vazio de fato -> valor`);
          return;
        }
        for (const [fact, value] of Object.entries(condition)) {
          if (!Object.prototype.hasOwnProperty.call(CONDITION_FACTS, fact)) {
            errors.push(`conditions[${index}].${fact}: fato desconhecido (use: ${Object.keys(CONDITION_FACTS).join(', ')})`);
          } else if (typeof value !== 'string' || !value.trim()) {
            errors.push(`conditions[${index}].${fact} deve ser string`);
          } else if (CONDITION_FACTS[fact] && !CONDITION_FACTS[fact].includes(value)) {
            errors.push(`conditions[${index}].${fact} deve ser um de: ${CONDITION_FACTS[fact].join(', ')}`);
          }
        }
      });
    }
    if (typeof data.decisionReasonsRequired !== 'boolean') {
      errors.push('decisionReasonsRequired é obrigatório e deve ser boolean');
    }

    return { isValid: errors.length === 0, errors };
  }

  static create(data, now = new Date()) {
    return {
      accessPolicyId: data.accessPolicyId || crypto.randomUUID(),
      policyName: data.policyName.trim(),
      policyVersion: data.policyVersion,
      applicableEntityTypes: [...data.applicableEntityTypes],
      purposeCodes: Array.isArray(data.purposeCodes) ? [...data.purposeCodes] : [],
      decisionEffect: data.decisionEffect,
      ruleExpression: data.ruleExpression,
      effectivePeriod: {
        start: new Date(data.effectivePeriod.start),
        end: data.effectivePeriod.end ? new Date(data.effectivePeriod.end) : null,
      },
      roleCodes: [...data.roleCodes],
      organizationScopeIds: [...data.organizationScopeIds],
      resourceScopes: [...data.resourceScopes],
      conditions: data.conditions.map((condition) => ({ ...condition })),
      decisionReasonsRequired: data.decisionReasonsRequired,
      createdBy: data.createdBy || null,
      createdAt: now,
    };
  }
}

function inForce(policy, now) {
  const start = new Date(policy.effectivePeriod.start);
  const end = policy.effectivePeriod.end ? new Date(policy.effectivePeriod.end) : null;
  return start <= now && (!end || end > now);
}

/** Per accessPolicyId, the highest version in force at `now`. */
function policiesInForce(policies, now = new Date()) {
  const latest = new Map();
  for (const policy of policies) {
    if (!inForce(policy, now)) continue;
    const current = latest.get(policy.accessPolicyId);
    if (!current || compareVersions(policy.policyVersion, current.policyVersion) > 0) {
      latest.set(policy.accessPolicyId, policy);
    }
  }
  return [...latest.values()];
}

// RNF008 AC3 (#1496): the facts each requested item resolves to (its
// specimen's study, protocol and collection, and the biobank that collection
// belongs to), recorded on its consentCompatibility entry.
const ITEM_FACTS = ['studyId', 'protocolId', 'collectionId', 'biobankId'];

/**
 * RNF008 AC3 (#1496): whether one item matches one item fact of a deny or
 * review_required. An item whose collection belongs to several biobanks
 * matches each of them (biobankIds), and no request declares a biobank.
 */
function itemMatches(entry, fact, value, accessRequest) {
  if (fact === 'biobankId') return entry.biobankId === value || (entry.biobankIds || []).includes(value);
  return entry[fact] === value || (fact !== 'collectionId' && accessRequest[fact] === value);
}

function conditionHolds(condition, facts) {
  return Object.entries(condition).every(([fact, value]) => facts[fact] === value);
}

/**
 * RNF008 AC3 (#1496): a deny or review_required policy restricts, so its
 * item facts hold when ANY requested item matches them: one item, the same
 * one for every item fact of the condition, whose study, protocol and
 * collection are the required values (an item's study and protocol also
 * match the request's declared ones). Adding an item of another collection,
 * study or protocol, or a dataset item, never switches such a policy off.
 * The other facts are the request's, as for a permit.
 */
function restrictiveConditionHolds(condition, facts, accessRequest, entries) {
  const pairs = Object.entries(condition);
  const itemPairs = pairs.filter(([fact]) => ITEM_FACTS.includes(fact));
  if (!pairs.filter(([fact]) => !ITEM_FACTS.includes(fact)).every(([fact, value]) => facts[fact] === value)) return false;
  if (itemPairs.length === 0) return true;
  return entries.some((entry) => itemPairs.every(([fact, value]) => itemMatches(entry, fact, value, accessRequest)));
}

/**
 * RNF008 AC3 (#1496): for a permit, the one value of `fact` every requested
 * item resolves to. Items of two values, a dataset item or an item that
 * resolves to none give null, so a permit conditioned on that fact does not
 * apply: the scope fails closed to review_required, never to permit.
 */
function singleItemValue(entries, fact) {
  const ids = entries.map((entry) => entry[fact] || null);
  if (ids.length === 0 || ids.some((id) => id === null)) return null;
  return ids.every((id) => id === ids[0]) ? ids[0] : null;
}

/** The items' one value, and only where the request declares the same one. */
function agreedItemValue(entries, fact, declared) {
  const value = singleItemValue(entries, fact);
  return value !== null && value === declared ? value : null;
}

/**
 * The facts an access request evaluation knows, from the request and its
 * compatibility evaluation (consentCompatibility entries, as
 * accessRequest.service's evaluateCompatibility builds them). studyId,
 * protocolId and collectionId are the one value every requested item
 * resolves to (singleItemValue), and studyId and protocolId must also be the
 * request's declared ones. These are the facts a permit is read against; a
 * deny or review_required reads its item facts per item
 * (restrictiveConditionHolds).
 */
function accessRequestFacts(accessRequest, consentCompatibility) {
  const entries = consentCompatibility || [];
  const anyDuo = entries.some((entry) => entry.duoCompatible !== null);
  return {
    consent: entries.length > 0 && entries.every((entry) => entry.consentValid !== false) ? 'compatible' : 'incompatible',
    duo: !anyDuo ? 'not_requested' : (entries.every((entry) => entry.duoCompatible !== false) ? 'compatible' : 'incompatible'),
    study: entries.length > 0 && entries.every((entry) => entry.studyActive) ? 'active' : 'inactive',
    organizationId: accessRequest.organizationId || null,
    studyId: agreedItemValue(entries, 'studyId', accessRequest.studyId || null),
    protocolId: agreedItemValue(entries, 'protocolId', accessRequest.protocolId || null),
    collectionId: singleItemValue(entries, 'collectionId'),
    biobankId: singleItemValue(entries, 'biobankId'),
    requestedPurpose: accessRequest.requestedPurpose || null,
    duoCode: accessRequest.duoCode || null,
  };
}

/** Whether a policy's scope covers this access request at all. */
function policyCovers(policy, accessRequest) {
  if (!policy.applicableEntityTypes.includes('AccessRequest')) return false;
  if (!policy.roleCodes.includes(ACCESS_REQUEST_ROLE)) return false;
  if (!policy.organizationScopeIds.includes(accessRequest.organizationId)) return false;
  const itemEntities = (accessRequest.requestedItems || []).map((item) => ITEM_TYPE_ENTITIES[item.itemType]);
  if (!itemEntities.some((entity) => policy.resourceScopes.includes(entity))) return false;
  if (policy.purposeCodes && policy.purposeCodes.length > 0) {
    const purposes = [accessRequest.requestedPurpose, accessRequest.duoCode].filter(Boolean);
    if (!purposes.some((purpose) => policy.purposeCodes.includes(purpose))) return false;
  }
  return true;
}

/**
 * RF024 AC3, RNF008 AC1/AC5: permit, deny or review_required, with the
 * policies applied and the reasons. Deny overrides review_required, which
 * overrides permit. An incompatible request (consent, DUO or study) is
 * denied whatever the policies say. With no policy applying, the effect is
 * review_required: access stays blocked until the committee decides
 * (deny by default holds at the access check, which a pending request fails).
 */
function evaluatePolicies(policies, accessRequest, consentCompatibility, now = new Date()) {
  const facts = accessRequestFacts(accessRequest, consentCompatibility);
  const reasons = [];
  const appliedPolicies = [];

  for (const policy of policiesInForce(policies, now)) {
    if (!policyCovers(policy, accessRequest)) continue;
    const results = policy.conditions.map((condition) => (policy.decisionEffect === 'permit'
      ? conditionHolds(condition, facts)
      : restrictiveConditionHolds(condition, facts, accessRequest, consentCompatibility || [])));
    const met = policy.ruleExpression === 'any-condition' ? results.some(Boolean) : results.every(Boolean);
    if (!met) {
      reasons.push(`${policy.policyName} ${policy.policyVersion}: condições não atendidas`);
      continue;
    }
    appliedPolicies.push({
      accessPolicyId: policy.accessPolicyId,
      policyVersion: policy.policyVersion,
      decisionEffect: policy.decisionEffect,
      decisionReasonsRequired: policy.decisionReasonsRequired,
    });
    reasons.push(`${policy.policyName} ${policy.policyVersion}: ${policy.decisionEffect}`);
  }

  // #1495 (RF024 AC2): a specimen whose collection regime, approval or custody
  // does not hold denies the request, naming each reason.
  const entries = consentCompatibility || [];
  const governanceIncompatible = entries.some((entry) => entry.governanceValid === false);
  const baseIncompatible = facts.consent !== 'compatible' || facts.duo === 'incompatible' || facts.study !== 'active';
  let effect;
  if (baseIncompatible || governanceIncompatible) {
    effect = 'deny';
    reasons.unshift(...entries.flatMap((entry) => (entry.governanceValid === false ? entry.governanceReasons || [] : [])));
    if (baseIncompatible) reasons.unshift('incompatível com consentimento, DUO ou estudo');
  } else if (appliedPolicies.some((p) => p.decisionEffect === 'deny')) {
    effect = 'deny';
  } else if (appliedPolicies.some((p) => p.decisionEffect === 'review_required')) {
    effect = 'review_required';
  } else if (appliedPolicies.some((p) => p.decisionEffect === 'permit')) {
    effect = 'permit';
  } else {
    effect = 'review_required';
    reasons.push('nenhuma AccessPolicy aplicável: requer revisão do comitê');
  }

  return {
    effect,
    appliedPolicies,
    reasons,
    decisionReasonsRequired: appliedPolicies.some((p) => p.decisionReasonsRequired),
    evaluatedAt: now,
  };
}

module.exports = AccessPolicyModel;
module.exports.DECISION_EFFECTS = DECISION_EFFECTS;
module.exports.RULE_EXPRESSIONS = RULE_EXPRESSIONS;
module.exports.CONDITION_FACTS = CONDITION_FACTS;
module.exports.ITEM_TYPE_ENTITIES = ITEM_TYPE_ENTITIES;
module.exports.compareVersions = compareVersions;
module.exports.policiesInForce = policiesInForce;
module.exports.accessRequestFacts = accessRequestFacts;
module.exports.evaluatePolicies = evaluatePolicies;
