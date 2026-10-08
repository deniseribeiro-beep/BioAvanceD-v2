/**
 * CollectionGovernanceApproval (RF004 AC3, RF020 AC3, RF021 AC2; dict v2.0.0
 * V2E-0067..0075): the ethics or institutional approval a collection's
 * governance context rests on, with its authority, document, checksum,
 * validity and state. A collection may hold several (REL-0033, 0..*).
 */
const crypto = require('crypto');

// V2E-0074's vocabulary cell names `draft` and its example `active`. The rest
// of the set is an inference from RF021 AC6 ("aprovação ... inativa"): an
// approval can be withdrawn for a time (suspended) or for good (revoked).
// Expiry is not a status: it is derived from effectivePeriod.end.
const APPROVAL_STATUSES = ['draft', 'active', 'suspended', 'revoked'];

// draft -> active is the approval coming into force; suspended -> active its
// reinstatement. revoked is final.
const STATUS_TRANSITIONS = {
  draft: ['active', 'revoked'],
  active: ['suspended', 'revoked'],
  suspended: ['active', 'revoked'],
  revoked: [],
};

// V2E-0072's vocabulary is SHA-256. The synthetic examples write checksums
// as `sha256:<hex>`; a bare 64-hex digest is the same value.
const SHA256 = /^(sha256:)?[a-f0-9]{64}$/i;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validDate(value) {
  return value !== undefined && value !== null && value !== '' && !Number.isNaN(new Date(value).getTime());
}

function isUri(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** A FHIR Period: start required, end optional and not before start. */
function validatePeriod(period, field) {
  const errors = [];
  if (!period || typeof period !== 'object' || Array.isArray(period)) {
    errors.push(`${field} é obrigatório ({ start, end? })`);
    return errors;
  }
  if (!validDate(period.start)) errors.push(`${field}.start deve ser uma data ISO 8601`);
  if (period.end !== undefined && period.end !== null && period.end !== '') {
    if (!validDate(period.end)) errors.push(`${field}.end deve ser uma data ISO 8601`);
    else if (validDate(period.start) && new Date(period.end) < new Date(period.start)) {
      errors.push(`${field}.end não pode ser anterior a ${field}.start`);
    }
  }
  return errors;
}

/** Whether `now` falls inside a period (end inclusive, open when absent). */
function periodHolds(period, now = new Date()) {
  if (!period || !validDate(period.start)) return false;
  if (new Date(period.start) > now) return false;
  if (period.end && validDate(period.end) && new Date(period.end) < now) return false;
  return true;
}

/** RF004 AC3 "aprovação aplicável vigente": active and inside its period. */
function isInForce(approval, now = new Date()) {
  return Boolean(approval) && approval.status === 'active' && periodHolds(approval.effectivePeriod, now);
}

class CollectionGovernanceApprovalModel {
  /** The canonical element names, for the catalog conformance test. */
  static fieldsOf(data = {}) {
    return {
      approvalId: data.approvalId,
      collectionId: data.collectionId,
      authority: data.authority,
      caae: data.caae,
      documentUri: data.documentUri,
      documentChecksum: data.documentChecksum,
      effectivePeriod: data.effectivePeriod,
      status: data.status,
      responsibleOrganizationId: data.responsibleOrganizationId,
    };
  }

  static validate(data = {}) {
    const errors = [];
    if (!isNonEmptyString(data.collectionId)) errors.push('collectionId é obrigatório');
    if (!isNonEmptyString(data.authority)) errors.push('authority é obrigatório');
    if (data.caae !== undefined && data.caae !== null && !isNonEmptyString(data.caae)) {
      errors.push('caae deve ser string não vazia quando informado');
    }
    if (!isUri(data.documentUri)) errors.push('documentUri é obrigatório e deve ser uma URI');
    if (!isNonEmptyString(data.documentChecksum) || !SHA256.test(data.documentChecksum)) {
      errors.push('documentChecksum é obrigatório e deve ser um SHA-256 (64 hex, opcionalmente sha256:)');
    }
    errors.push(...validatePeriod(data.effectivePeriod, 'effectivePeriod'));
    const status = data.status ?? 'draft';
    if (!APPROVAL_STATUSES.includes(status)) {
      errors.push(`status deve ser um de: ${APPROVAL_STATUSES.join(', ')}`);
    }
    if (!isNonEmptyString(data.responsibleOrganizationId)) errors.push('responsibleOrganizationId é obrigatório');
    return { isValid: errors.length === 0, errors };
  }

  static create(data = {}) {
    const now = new Date();
    return {
      approvalId: data.approvalId || crypto.randomUUID(),
      collectionId: data.collectionId,
      authority: data.authority.trim(),
      caae: data.caae ?? null,
      documentUri: data.documentUri,
      documentChecksum: data.documentChecksum,
      effectivePeriod: { start: data.effectivePeriod.start, end: data.effectivePeriod.end || null },
      status: data.status ?? 'draft',
      responsibleOrganizationId: data.responsibleOrganizationId,
      statusHistory: [],
      createdBy: data.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  static canTransition(from, to) {
    return (STATUS_TRANSITIONS[from] || []).includes(to);
  }
}

module.exports = CollectionGovernanceApprovalModel;
module.exports.APPROVAL_STATUSES = APPROVAL_STATUSES;
module.exports.STATUS_TRANSITIONS = STATUS_TRANSITIONS;
module.exports.isInForce = isInForce;
module.exports.periodHolds = periodHolds;
module.exports.validatePeriod = validatePeriod;
module.exports.isNonEmptyString = isNonEmptyString;
module.exports.validDate = validDate;
