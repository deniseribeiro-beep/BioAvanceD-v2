const { getCollection } = require('../utils/collectionResolver');
const logger = require('../utils/logger');
const LabelIdentifierModel = require('../models/LabelIdentifier');
const ScanEventModel = require('../models/ScanEvent');
const IdentificationPolicyModel = require('../models/IdentificationPolicy');
const physicalChain = require('./physicalChain.service');
const { ensureLabelIdentifierIndexes, ensureScanEventIndexes } = require('../utils/physicalChainIndexes');

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
    await ensureLabelIdentifierIndexes(await getCollection(db, 'labelIdentifiers'));
    await ensureScanEventIndexes(await getCollection(db, 'scanEvents'));
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

// #1378: with a session the label is inserted in the caller's transaction
// and no index is built beside it; the Foundation job builds it at boot.
// `printed: false` issues a label with no print batch. `provenance` is
// kept beside the model's fields as `migratedFrom`.
async function registerLabel(db, data, { session, printed = true, provenance } = {}) {
  if (!session) await ensureLabelIndexes(db);
  let label;
  try {
    label = LabelIdentifierModel.create(data, { printed });
  } catch (error) {
    throw Object.assign(error, { code: 'VALIDATION_ERROR', statusCode: 422 });
  }
  if (provenance) label = { ...label, migratedFrom: provenance };
  try {
    await (await getCollection(db, 'labelIdentifiers')).insertOne(label, session ? { session } : undefined);
  } catch (error) {
    if (error?.code === 11000) {
      throw Object.assign(new Error(`Valor ${label.encodedValue} já ativo neste namespace`), { code: 'LABEL_EXISTS', statusCode: 409 });
    }
    throw error;
  }
  return label;
}

// #1378 (ELM-0116, "retained for migration read compatibility"): a code
// printed before its label was migrated is still a sample's legacy barcode.
// Exact match only; an all-digit value also matches its Number, since a
// legacy barcode may be stored as one. This fallback goes when the
// migration window closes.
async function findLegacySample(db, normalizedValue) {
  const samples = await getCollection(db, 'samples');
  const sample = await samples.findOne({ barcode: normalizedValue });
  if (sample || !/^[0-9]+$/.test(normalizedValue)) return sample;
  return samples.findOne({ barcode: Number(normalizedValue) });
}

async function recordScan(db, scan, { normalizedValue, symbology, specimenId, retainRawValue }) {
  const scanEvent = ScanEventModel.create({
    deviceId: scan.deviceId,
    actorId: scan.actorId,
    locationId: scan.locationId,
    rawValueProtected: retainRawValue ? scan.rawValue ?? null : null,
    normalizedValue,
    symbology,
    targetType: 'specimen',
    targetId: specimenId,
    operationContext: 'lookup',
    result: 'resolved',
    correlationId: scan.correlationId,
    occurredAt: scan.occurredAt,
  }, { retainRawValue });
  await ensureLabelIndexes(db);
  await (await getCollection(db, 'scanEvents')).insertOne(scanEvent);
  return scanEvent;
}

// Returns { resolved, reason, source, label, containerId, specimenId, scanEvent }.
// `inScope`, when given, is asked about the resolved specimen before any
// ScanEvent is written, so a scan the caller may not see leaves no event.
// An active label always wins over a legacy barcode with the same value, and
// a label that resolves to no specimen does not fall back.
async function resolveScan(db, scan, { policy = null, retainRawValue = false, inScope = null } = {}) {
  const normalizedValue = normalizeScannedValue(scan.rawValue ?? scan.normalizedValue);
  const symbology = String(scan.symbology || '').toLowerCase();
  if (policy && !IdentificationPolicyModel.allows(policy, symbology)) {
    return { resolved: false, reason: 'SYMBOLOGY_NOT_ALLOWED', normalizedValue };
  }

  const label = await (await getCollection(db, 'labelIdentifiers')).findOne({ encodedValue: normalizedValue, status: 'active' });
  if (!label) {
    const sample = await findLegacySample(db, normalizedValue);
    if (!sample) {
      return { resolved: false, reason: 'UNKNOWN_IDENTIFIER', normalizedValue };
    }
    // The chain's key: a legacy sample with no specimenId is keyed by its _id.
    const specimenId = String(sample.specimenId || sample._id);
    if (inScope && !(await inScope(specimenId))) {
      return { resolved: false, reason: 'OUT_OF_SCOPE', normalizedValue };
    }
    const assignment = await physicalChain.openSpecimenAssignment(db, specimenId);
    const scanEvent = await recordScan(db, scan, { normalizedValue, symbology, specimenId, retainRawValue });
    return { resolved: true, source: 'legacy_barcode', normalizedValue, label: null, containerId: assignment ? assignment.containerId : null, specimenId, scanEvent };
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

  const scanEvent = await recordScan(db, scan, { normalizedValue, symbology, specimenId: open.specimenId, retainRawValue });
  return { resolved: true, source: 'label', normalizedValue, label, containerId: label.targetId, specimenId: open.specimenId, scanEvent };
}

module.exports = {
  normalizeScannedValue,
  registerLabel,
  resolveScan,
  ensureLabelIndexes,
};
