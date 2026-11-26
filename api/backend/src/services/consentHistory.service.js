/**
 * RF010 AC4-AC6: a Consent's current state is derived from its history --
 * its ConsentDecisionEvent rows (accepted, revoked, superseded) and its
 * ConsentRevocation rows -- never set in place. `recomputeConsentState` is
 * the one writer of the state fields on the consent document:
 *
 * - `currentStateDerived` (dict v2.0.0 V2E-0436): active, partially_revoked,
 *   revoked or superseded.
 * - `effectivePermissions`: the responses less every permission a revocation
 *   in effect blocks. Enforcement reads it through `effectivePermissionsOf`;
 *   `responses` stays the manifestation as given.
 * - `withdrawalDateTime` / `withdrawalScope` (ELM-0108/0109), `revokedAt`.
 * - `status`, the ACTIVE/REVOKED field every older reader queries: ACTIVE
 *   while any use is still permitted, REVOKED once revoked or superseded.
 *
 * Every field is a projection of rows that are only ever appended, so a
 * recompute from the same rows writes the same values.
 */
const ConsentDecisionEventModel = require('../models/ConsentDecisionEvent');
const ConsentRevocationModel = require('../models/ConsentRevocation');
const consentEvidence = require('./consentEvidence.service');
const { getCollection } = require('../utils/collectionResolver');

const { SCOPE_ALL } = ConsentRevocationModel;
const CONSENT_STATES = ['active', 'partially_revoked', 'revoked', 'superseded'];

function validationError(errors) {
  const error = new Error(errors.join(', '));
  error.statusCode = 422;
  error.details = errors.map((message) => ({ message }));
  return error;
}

/** The consent's own identifier, which its history rows reference. */
function consentKeyOf(consent) {
  return consent.consentId || String(consent._id);
}

function grantedKeysOf(responses = {}) {
  return Object.keys(responses).filter((key) => responses[key] === true);
}

/** Where the participant was when they revoked, plus the clock on their device.
 *  The server's own clock stays on effectiveAt. A refusal or an unusable
 *  reading is recorded as unavailable and never blocks the revocation. */
function normalizeRevocationLocation(raw) {
  if (!raw || raw.status === 'unavailable') return { status: 'unavailable' };
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  const inRange = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
  if (!inRange) return { status: 'unavailable' };
  const accuracy = Number(raw.accuracyMeters ?? raw.accuracy);
  const captured = raw.capturedAt ? new Date(raw.capturedAt) : null;
  return {
    status: 'captured',
    latitude,
    longitude,
    accuracyMeters: Number.isFinite(accuracy) ? accuracy : null,
    capturedAt: captured && !Number.isNaN(captured.getTime()) ? captured.toISOString() : null,
  };
}

/**
 * Derive a consent's state at `at` from its history. A consent document is
 * only ever written as an acceptance, so the document itself is the
 * accepted manifestation; one written before this history existed and
 * already REVOKED, with no row to say why, stays revoked.
 */
function deriveConsentState(consent, events = [], revocations = [], at = new Date()) {
  const responses = consent.responses || {};
  const granted = grantedKeysOf(responses);
  const inEffect = revocations.filter((row) => new Date(row.effectiveAt).getTime() <= at.getTime());
  const superseded = events.some((event) => event.decision === 'superseded');

  const blocked = new Set();
  let blocksAll = false;
  for (const row of inEffect) {
    for (const entry of row.scope || []) {
      if (entry === SCOPE_ALL) blocksAll = true;
      else blocked.add(entry);
    }
  }
  if (granted.length > 0 && granted.every((key) => blocked.has(key))) blocksAll = true;

  const legacyRevoked = events.length === 0 && revocations.length === 0 && consent.status === 'REVOKED';

  let currentStateDerived = 'active';
  if (superseded) currentStateDerived = 'superseded';
  else if (blocksAll || legacyRevoked) currentStateDerived = 'revoked';
  else if (blocked.size > 0) currentStateDerived = 'partially_revoked';

  const permitsNothing = currentStateDerived === 'superseded' || currentStateDerived === 'revoked';
  const effectivePermissions = {};
  for (const key of Object.keys(responses)) {
    effectivePermissions[key] = !permitsNothing && responses[key] === true && !blocked.has(key);
  }

  const effectiveTimes = inEffect.map((row) => new Date(row.effectiveAt).getTime());
  const supersededAt = events
    .filter((event) => event.decision === 'superseded')
    .map((event) => new Date(event.occurredAt).getTime());
  let revokedAt = null;
  if (currentStateDerived === 'revoked') {
    revokedAt = legacyRevoked ? (consent.revokedAt || null) : new Date(Math.max(...effectiveTimes));
  } else if (currentStateDerived === 'superseded') {
    revokedAt = new Date(Math.min(...supersededAt));
  }

  return {
    currentStateDerived,
    status: permitsNothing ? 'REVOKED' : 'ACTIVE',
    effectivePermissions,
    revokedAt,
    withdrawalDateTime: effectiveTimes.length > 0 ? new Date(Math.min(...effectiveTimes)) : null,
    withdrawalScope: blocksAll && !legacyRevoked ? [SCOPE_ALL] : [...blocked],
  };
}

/** What a consent permits now: its derived permissions, or, for a document
 *  no recompute has touched, its responses as given. */
function effectivePermissionsOf(consent) {
  if (!consent) return {};
  return consent.effectivePermissions || consent.responses || {};
}

/** #1313: the options argument for `session`, the caller's transaction, if
 *  any; none without one. Every read and write below takes it, so a
 *  recompute inside a transaction reads the decision event the same
 *  transaction just wrote. */
function sessionArg(session) {
  return session ? [{ session }] : [];
}

async function readHistory(db, consentKey, session = null) {
  const events = await (await getCollection(db, 'consentDecisionEvents'))
    .find({ consentId: consentKey }, ...sessionArg(session)).sort({ occurredAt: 1 }).toArray();
  const revocations = await (await getCollection(db, 'consentRevocations'))
    .find({ consentId: consentKey }, ...sessionArg(session)).sort({ effectiveAt: 1 }).toArray();
  return { events, revocations };
}

async function recomputeConsentState(db, consent, session = null) {
  const { events, revocations } = await readHistory(db, consentKeyOf(consent), session);
  const derived = deriveConsentState(consent, events, revocations);
  await (await getCollection(db, 'consents')).updateOne(
    { _id: consent._id },
    { $set: { ...derived, updatedAt: new Date() } },
    ...sessionArg(session)
  );
  return { ...consent, ...derived };
}

async function appendDecisionEvent(db, data, session = null) {
  const validation = ConsentDecisionEventModel.validate(data);
  if (!validation.isValid) throw validationError(validation.errors);
  const event = ConsentDecisionEventModel.create(data);
  await (await getCollection(db, 'consentDecisionEvents')).insertOne(event, ...sessionArg(session));
  return event;
}

/** The acceptance a newly written consent document records. */
async function recordAcceptance(db, consent, actor, session = null) {
  await appendDecisionEvent(db, {
    ...actor,
    consentId: consentKeyOf(consent),
    participantId: consent.participantId,
    templateVersionId: String(consent.consentTemplateId),
    decision: 'accepted',
    evidenceUri: consent.evidenceDocumentUri,
    evidenceHash: consent.evidenceHash,
    occurredAt: consent.signedAt,
  }, session);
  return recomputeConsentState(db, consent, session);
}

/** A newer consent of the same participant supersedes `prior`. The newer
 *  manifestation's evidence is the evidence of the supersession. */
async function recordSupersession(db, prior, successor, actor, session = null) {
  await appendDecisionEvent(db, {
    ...actor,
    consentId: consentKeyOf(prior),
    participantId: prior.participantId,
    templateVersionId: String(prior.consentTemplateId),
    decision: 'superseded',
    evidenceUri: successor.evidenceDocumentUri,
    evidenceHash: successor.evidenceHash,
    occurredAt: successor.signedAt,
  }, session);
  await (await getCollection(db, 'consents')).updateOne(
    { _id: prior._id },
    { $set: { supersededByConsentId: consentKeyOf(successor) } },
    ...sessionArg(session)
  );
  return recomputeConsentState(db, { ...prior, supersededByConsentId: consentKeyOf(successor) }, session);
}

/**
 * Revoke `scope` of a consent from now on (RF010 AC6). Returns null when
 * the request blocks nothing the consent still permits -- a consent already
 * revoked or superseded, or permissions already revoked -- so a repeat is a
 * no-op that appends nothing.
 */
async function recordRevocation(db, consent, request = {}, actor, session = null) {
  const permitted = effectivePermissionsOf(consent);
  const scope = Array.isArray(request.scope) && request.scope.length > 0 ? request.scope : [SCOPE_ALL];
  const priorUseDisposition = request.priorUseDisposition
    || (Array.isArray(request.retentionObligationIds) && request.retentionObligationIds.length > 0
      ? 'retain_legal_obligation'
      : 'retain_history');
  const draft = {
    consentId: consentKeyOf(consent),
    scope,
    reason: request.reason,
    priorUseDisposition,
    retentionObligationIds: request.retentionObligationIds,
    decisionEventId: 'pending',
  };
  const validation = ConsentRevocationModel.validate(draft, Object.keys(consent.responses || {}));
  if (!validation.isValid) throw validationError(validation.errors);

  const stillPermitted = grantedKeysOf(permitted);
  const blocksSomething = consent.status !== 'REVOKED'
    && (scope.includes(SCOPE_ALL) || scope.some((key) => stillPermitted.includes(key)));
  if (!blocksSomething) return null;

  const effectiveAt = new Date();
  const location = normalizeRevocationLocation(request.location);
  const revocation = ConsentRevocationModel.create({ ...draft, participantId: consent.participantId, effectiveAt });
  revocation.location = location;
  const evidence = consentEvidence.storeRevocationEvidence({
    consentId: draft.consentId,
    consentRevocationId: revocation.consentRevocationId,
    participantId: consent.participantId,
    scope: revocation.scope,
    reason: revocation.reason,
    priorUseDisposition: revocation.priorUseDisposition,
    effectiveAt,
    signerRole: actor.signerRole,
    signerId: actor.signerId,
    channel: actor.channel,
    location,
  });
  const event = await appendDecisionEvent(db, {
    ...actor,
    consentId: draft.consentId,
    participantId: consent.participantId,
    templateVersionId: String(consent.consentTemplateId),
    decision: 'revoked',
    evidenceUri: evidence.evidenceUri,
    evidenceHash: evidence.evidenceHash,
    occurredAt: effectiveAt,
  }, session);
  revocation.decisionEventId = event.consentDecisionEventId;
  // What decrypts the evidence the decision event names.
  revocation.evidenceEncryption = evidence.evidenceEncryption || null;
  await (await getCollection(db, 'consentRevocations')).insertOne(revocation, ...sessionArg(session));
  const updated = await recomputeConsentState(db, consent, session);
  return { consent: updated, revocation, event };
}

/** Newest first, the order `getPatientConsent` reads a participant's consents in. */
function isNewerConsent(candidate, current) {
  const timeOf = (value) => (value ? new Date(value).getTime() : 0);
  const bySigned = timeOf(candidate.signedAt) - timeOf(current.signedAt);
  if (bySigned !== 0) return bySigned > 0;
  return timeOf(candidate.createdAt) > timeOf(current.createdAt);
}

function groupByConsentId(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.consentId)) groups.set(row.consentId, []);
    groups.get(row.consentId).push(row);
  }
  return groups;
}

/**
 * #1383 (RF010 AC5): the derived state of each participant's newest consent,
 * keyed by participantId. A participant with no consent has no entry. Three
 * reads for any number of participants, none per participant.
 */
async function consentStatesOf(db, participantIds = []) {
  const ids = [...new Set(participantIds
    .filter((id) => id !== undefined && id !== null)
    .map((id) => String(id))
    .filter((id) => id !== ''))];
  const states = new Map();
  if (ids.length === 0) return states;

  const consents = await (await getCollection(db, 'consents'))
    .find({ participantId: { $in: ids } }).toArray();
  const newest = new Map();
  for (const consent of consents) {
    const id = String(consent.participantId);
    const current = newest.get(id);
    if (!current || isNewerConsent(consent, current)) newest.set(id, consent);
  }
  if (newest.size === 0) return states;

  const keys = [...newest.values()].map(consentKeyOf);
  const events = groupByConsentId(await (await getCollection(db, 'consentDecisionEvents'))
    .find({ consentId: { $in: keys } }).toArray());
  const revocations = groupByConsentId(await (await getCollection(db, 'consentRevocations'))
    .find({ consentId: { $in: keys } }).toArray());

  for (const [id, consent] of newest) {
    const key = consentKeyOf(consent);
    states.set(id, deriveConsentState(consent, events.get(key) || [], revocations.get(key) || []).currentStateDerived);
  }
  return states;
}

/** The consent's history, oldest first, for a reader. */
async function getHistory(db, consent) {
  return readHistory(db, consentKeyOf(consent));
}

module.exports = {
  CONSENT_STATES,
  consentKeyOf,
  consentStatesOf,
  deriveConsentState,
  effectivePermissionsOf,
  recomputeConsentState,
  appendDecisionEvent,
  recordAcceptance,
  recordSupersession,
  recordRevocation,
  getHistory,
  normalizeRevocationLocation,
};
