const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');
const LabelIdentifierModel = require('../models/LabelIdentifier');
const ScanEventModel = require('../models/ScanEvent');
const IdentificationPolicyModel = require('../models/IdentificationPolicy');

// #1314 (RF016 AC6): the resolver captures, decodes, normalizes and
// resolves, and nothing else. It never authorizes the operation a scan is
// for; the route that calls it does. A code resolves through its active
// LabelIdentifier to a container, and through the container's open
// SpecimenContainerAssignment to a specimen. An empty container resolves to
// no specimen (RULE-032), so only a resolved scan becomes a ScanEvent.

const ensuredDbs = new WeakSet();

async function ensureLabelIndexes(db) {
  if (!db || ensuredDbs.has(db)) return;
  ensuredDbs.add(db);
  try {
    await (await getCollection(db, 'labelIdentifiers')).createIndex(
      { namespaceRegistryId: 1, encodedValue: 1 },
      { unique: true, name: 'uniq_active_label_value', partialFilterExpression: { status: 'active' } }
    );
    await (await getCollection(db, 'scanEvents')).createIndex({ targetId: 1, occurredAt: -1 });
  } catch (error) {
    logger.warn(`[LABEL_RESOLVER] Falha ao criar índices: ${error.message}`);
  }
}

// A scanner may prefix the AIM symbology identifier (`]d2` for Data Matrix,
// `]C1` for GS1-128, `]Q1` for QR) and trailing whitespace; neither is part
// of the encoded value.
function normalizeScannedValue(raw) {
  return String(raw ?? '').trim().replace(/^\][A-Za-z][0-9A-Za-z]/, '');
}

async function registerLabel(db, data) {
  await ensureLabelIndexes(db);
  const label = LabelIdentifierModel.create(data);
  try {
    await (await getCollection(db, 'labelIdentifiers')).insertOne(label);
  } catch (error) {
    if (error?.code === 11000) {
      throw Object.assign(new Error(`Valor ${label.encodedValue} já ativo neste namespace`), { code: 'LABEL_EXISTS', statusCode: 409 });
    }
    throw error;
  }
  return label;
}

// Returns { resolved, reason, label, containerId, specimenId, scanEvent }.
// `inScope`, when given, is asked about the resolved specimen before any
// ScanEvent is written, so a scan the caller may not see leaves no event.
async function resolveScan(db, scan, { policy = null, retainRawValue = false, inScope = null } = {}) {
  const normalizedValue = normalizeScannedValue(scan.rawValue ?? scan.normalizedValue);
  const symbology = String(scan.symbology || '').toLowerCase();
  if (policy && !IdentificationPolicyModel.allows(policy, symbology)) {
    return { resolved: false, reason: 'SYMBOLOGY_NOT_ALLOWED', normalizedValue };
  }

  const label = await (await getCollection(db, 'labelIdentifiers')).findOne({ encodedValue: normalizedValue, status: 'active' });
  if (!label) {
    return { resolved: false, reason: 'UNKNOWN_IDENTIFIER', normalizedValue };
  }
  if (label.targetType !== 'container') {
    return { resolved: false, reason: 'NOT_A_CONTAINER', normalizedValue, label };
  }

  const open = await (await getCollection(db, 'specimenContainerAssignments')).findOne({ containerId: label.targetId, assignmentStatus: 'active' });
  if (!open) {
    return { resolved: false, reason: 'EMPTY_CONTAINER', normalizedValue, label, containerId: label.targetId };
  }
  if (inScope && !(await inScope(open.specimenId))) {
    return { resolved: false, reason: 'OUT_OF_SCOPE', normalizedValue };
  }

  const scanEvent = ScanEventModel.create({
    deviceId: scan.deviceId,
    actorId: scan.actorId,
    locationId: scan.locationId,
    rawValueProtected: retainRawValue ? scan.rawValue ?? null : null,
    normalizedValue,
    symbology,
    targetType: 'specimen',
    targetId: open.specimenId,
    operationContext: 'lookup',
    result: 'resolved',
    correlationId: scan.correlationId,
    occurredAt: scan.occurredAt,
  }, { retainRawValue });
  await ensureLabelIndexes(db);
  await (await getCollection(db, 'scanEvents')).insertOne(scanEvent);
  return { resolved: true, normalizedValue, label, containerId: label.targetId, specimenId: open.specimenId, scanEvent };
}

module.exports = {
  normalizeScannedValue,
  registerLabel,
  resolveScan,
  ensureLabelIndexes,
};
