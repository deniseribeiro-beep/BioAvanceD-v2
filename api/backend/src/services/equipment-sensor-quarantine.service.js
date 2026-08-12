const { ObjectId } = require('mongodb');
const SampleMovementModel = require('../models/SampleMovement');
const { appendMovementWithHashChain } = require('../utils/sampleMovementLedger');
const { getCollection } = require('../utils/collectionResolver');
const quarantineActionService = require('./quarantine-action.service');
const logger = require('../utils/logger');

const QUARANTINE_TRIGGER_STATUSES = new Set([
  'offline',
  'desligado',
  'inactive',
  'inativo',
  'repair',
  'maintenance',
  'aguardando reparo',
  'awaiting repair',
  'manutencao',
  'manutenção'
]);

function normalizeStatus(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeString(value) {
  return String(value || '').trim();
}

function isQuarantineTriggerStatus(value) {
  return QUARANTINE_TRIGGER_STATUSES.has(normalizeStatus(value));
}

function buildStatusChangeReason(source, sourceId, statusValue) {
  const normalizedSource = source === 'sensor' ? 'sensor' : 'equipamento';
  return `Quarentena automática por ${normalizedSource} ${sourceId || 'desconhecido'} com status ${statusValue}`;
}

function buildColdChainIncidentReason(incident = {}) {
  const sensorKey = normalizeString(incident.sensorKey || incident.sensorId || incident.sensorID) || 'sensor desconhecido';
  const temperature = incident.currentTemperature !== undefined ? ` temperatura=${incident.currentTemperature}` : '';
  return `Quarentena automática por incidente de cadeia fria (${sensorKey})${temperature}`;
}

function collectEquipmentIdentifiers(equipmentContext = {}) {
  const identifiers = new Set();

  if (equipmentContext._id) {
    identifiers.add(String(equipmentContext._id));
  }

  if (equipmentContext.equipmentID !== undefined && equipmentContext.equipmentID !== null) {
    identifiers.add(String(equipmentContext.equipmentID));
  }

  if (equipmentContext.id !== undefined && equipmentContext.id !== null) {
    identifiers.add(String(equipmentContext.id));
  }

  return [...identifiers];
}

function collectIdentifierValues(...values) {
  const ids = [];
  values.forEach((value) => {
    if (Array.isArray(value)) {
      ids.push(...collectIdentifierValues(...value));
      return;
    }
    if (value === undefined || value === null || normalizeString(value) === '') {
      return;
    }
    const numeric = Number(value);
    ids.push(Number.isFinite(numeric) ? numeric : value);
  });
  return [...new Set(ids.map((value) => String(value)))].map((value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  });
}

/**
 * #462/#463: `equipmentID`/`containerID` variants (string + numeric forms)
 * for an `$in` match — same shape as the sibling helper in
 * `sample.service.js`/`intakeWizard.js`.
 */
function buildIdVariants(...ids) {
  const variants = [];
  const seen = new Set();
  const add = (value) => {
    if (value === undefined || value === null || value === '') return;
    const key = `${typeof value}:${String(value)}`;
    if (!seen.has(key)) {
      seen.add(key);
      variants.push(value);
    }
  };

  for (const id of ids) {
    if (id === undefined || id === null || id === '') continue;
    add(id);
    add(String(id));

    const numeric = Number(id);
    if (Number.isFinite(numeric)) {
      add(numeric);
    }
  }

  return variants;
}

function dedupeIds(ids) {
  const seen = new Set();
  const result = [];
  ids.forEach((id) => {
    const key = String(id);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(id);
    }
  });
  return result;
}

function buildSensorLookup(sensorKey) {
  const raw = normalizeString(sensorKey);
  const variants = [raw];
  if (ObjectId.isValid(raw)) variants.push(new ObjectId(raw));
  return {
    $or: [
      { sensorId: { $in: variants } },
      { sensorID: { $in: variants } },
      { _id: { $in: variants } },
      { macAddress: raw },
    ]
  };
}

/**
 * #464: resolves the FREEZER `StorageContainer`(s) whose `containerID`
 * matches one of the given equipment identifiers — the same direct join
 * (`freezer.containerID === Equipment.equipmentID`) #462/#463 already
 * established, applied in reverse (equipment -> freezer instead of
 * freezer -> equipment).
 */
async function resolveFreezersByEquipmentIdentifiers(db, identifiers = [], options = {}) {
  const variants = buildIdVariants(...identifiers);
  if (variants.length === 0) {
    return [];
  }

  const storageContainersCollection = db.collection('storageContainers');
  const sessionOptions = options.session ? { session: options.session } : undefined;

  return storageContainersCollection.find(
    {
      containerType: 'FREEZER',
      containerID: { $in: variants }
    },
    sessionOptions
  ).toArray();
}

/**
 * #464: walks a FREEZER `StorageContainer`'s children down to the
 * `StorageBox` level (FREEZER -> SHELF -> RACK -> optional DRAWER -> BOX),
 * the mirror image of #462's upward `resolveStorageHierarchyForBox` walk.
 */
async function findBoxIdsUnderFreezer(db, freezerId, options = {}) {
  const storageContainersCollection = db.collection('storageContainers');
  const storageBoxesCollection = db.collection('storageBoxes');
  const sessionOptions = options.session ? { session: options.session } : undefined;

  const shelves = await storageContainersCollection.find(
    { parent_id: freezerId, containerType: 'SHELF' },
    sessionOptions
  ).toArray();
  const shelfIds = shelves.map((shelf) => shelf._id);
  if (shelfIds.length === 0) return [];

  const racks = await storageContainersCollection.find(
    { parent_id: { $in: shelfIds }, containerType: 'RACK' },
    sessionOptions
  ).toArray();
  const rackIds = racks.map((rack) => rack._id);
  if (rackIds.length === 0) return [];

  const drawers = await storageContainersCollection.find(
    { parent_id: { $in: rackIds }, containerType: 'DRAWER' },
    sessionOptions
  ).toArray();
  const drawerIds = drawers.map((drawer) => drawer._id);

  const boxes = await storageBoxesCollection.find(
    { parent_id: { $in: [...rackIds, ...drawerIds] } },
    sessionOptions
  ).toArray();

  return boxes.map((box) => box._id);
}

async function findBoxIdsByEquipment(db, equipmentContext = {}, options = {}) {
  const identifiers = collectEquipmentIdentifiers(equipmentContext);
  if (identifiers.length === 0) {
    return [];
  }

  const freezers = await resolveFreezersByEquipmentIdentifiers(db, identifiers, options);
  const boxIds = [];
  for (const freezer of freezers) {
    boxIds.push(...await findBoxIdsUnderFreezer(db, freezer._id, options));
  }

  return dedupeIds(boxIds);
}

async function findEquipmentByMetadata(db, metadata = {}, options = {}) {
  const equipmentReference = metadata?.equipment || metadata?.equipmentId || metadata?.equipmentID;
  if (!equipmentReference) return null;

  const equipmentCollection = db.collection('equipment');
  const sessionOptions = options.session ? { session: options.session } : undefined;
  const variants = [equipmentReference, normalizeString(equipmentReference)];
  if (ObjectId.isValid(normalizeString(equipmentReference))) {
    variants.push(new ObjectId(normalizeString(equipmentReference)));
  }
  const numeric = Number(equipmentReference);
  if (Number.isFinite(numeric)) variants.push(numeric);

  return equipmentCollection.findOne({
    $or: [
      { _id: { $in: variants } },
      { equipmentID: { $in: variants } },
      { id: { $in: variants } },
    ]
  }, sessionOptions);
}

/**
 * #464: `sensor.locationId`/`locationID` (and `sensorMetadata`'s mirror
 * fields) carry the same equipment-level identifier #462/#463 already
 * established for the RF004 sensor gate (`freezer.containerID ===
 * Equipment.equipmentID`), not a pointer into the retiring `locations`
 * collection — so resolution goes straight from that value to a matching
 * FREEZER `StorageContainer`, no `locations` lookup involved. Per the
 * coexistence rule, no compatibility shim reading both `Location` and the
 * canonical model — the legacy `locations`-by-sensor reverse lookup this
 * function used to fall back to is dropped, not kept alongside.
 */
async function findBoxIdsBySensorKey(db, sensorKey, options = {}) {
  const rawSensorKey = normalizeString(sensorKey);
  if (!rawSensorKey) return [];

  const sessionOptions = options.session ? { session: options.session } : undefined;
  const boxIds = [];

  try {
    const sensorsCollection = db.collection('sensors');
    const sensors = await sensorsCollection.find(buildSensorLookup(rawSensorKey), sessionOptions).toArray();
    for (const sensor of sensors) {
      const equipmentIdentifiers = collectIdentifierValues(sensor.locationId, sensor.locationID, sensor.storageLocation?.locationID);
      const freezers = await resolveFreezersByEquipmentIdentifiers(db, equipmentIdentifiers, options);
      for (const freezer of freezers) {
        boxIds.push(...await findBoxIdsUnderFreezer(db, freezer._id, options));
      }
    }
  } catch (error) {
    logger.warn('[QUARANTINE][COLD_CHAIN] Não foi possível consultar sensors para incidente', { sensorKey: rawSensorKey, error: error.message });
  }

  try {
    const sensorMetadataCollection = db.collection('sensorMetadata');
    const metadataDocs = await sensorMetadataCollection.find(buildSensorLookup(rawSensorKey), sessionOptions).toArray();

    for (const metadata of metadataDocs) {
      const equipmentIdentifiers = collectIdentifierValues(metadata.locationId, metadata.locationID, metadata.storageLocation?.locationID);
      const freezersFromMetadata = await resolveFreezersByEquipmentIdentifiers(db, equipmentIdentifiers, options);
      for (const freezer of freezersFromMetadata) {
        boxIds.push(...await findBoxIdsUnderFreezer(db, freezer._id, options));
      }

      const equipment = await findEquipmentByMetadata(db, metadata, options);
      if (equipment) {
        boxIds.push(...await findBoxIdsByEquipment(db, equipment, options));
      }
    }
  } catch (error) {
    logger.warn('[QUARANTINE][COLD_CHAIN] Não foi possível consultar sensorMetadata para incidente', { sensorKey: rawSensorKey, error: error.message });
  }

  return dedupeIds(boxIds);
}

function buildSampleFilterFromBoxIds(boxIds = []) {
  if (!Array.isArray(boxIds) || boxIds.length === 0) {
    return null;
  }

  return { 'storageLocation.boxId': { $in: dedupeIds(boxIds) } };
}

async function quarantineSamplesByFilter(db, filter, context = {}) {
  if (!filter) {
    return { matched: 0, quarantined: 0, movements: 0 };
  }

  const now = new Date();
  const samplesCollection = await getCollection(db, 'samples');
  const movementsCollection = await getCollection(db, 'sampleMovements');
  const queryOptions = context.session ? { session: context.session } : undefined;

  // #540: the "not already quarantined" guard reads the canonical
  // specimenStatus field, not the legacy status/currentStatus pair (no
  // longer written below either).
  const samples = await samplesCollection
    .find(
      {
        $and: [
          filter,
          { specimenStatus: { $ne: 'quarantined' } }
        ]
      },
      queryOptions
    )
    .toArray();

  if (samples.length === 0) {
    return { matched: 0, quarantined: 0, movements: 0 };
  }

  let quarantined = 0;
  let movements = 0;

  for (const sample of samples) {
    const sampleId = String(sample._id);
    const specimenStatus = 'quarantined';
    const updatePayload = {
      specimenStatus,
      quarantineLocation: 'Quarentena',
      quarantineReason: context.reason || null,
      quarantineSource: context.source || null,
      quarantineSourceId: context.sourceId || null,
      quarantinedAt: now,
      updatedAt: now
    };

    if (context.coldChainIncidentId) {
      updatePayload.quarantineReasonCode = 'COLD_CHAIN_INCIDENT';
      updatePayload.coldChainIncidentId = String(context.coldChainIncidentId);
      updatePayload.coldChainSensorKey = context.coldChainSensorKey || null;
      updatePayload.coldChainQuarantinedAt = now;
      updatePayload.coldChainStatus = 'INCIDENT_OPEN';
      updatePayload.coldChainReviewRequired = true;
    }

    if (sample.location && typeof sample.location === 'object' && !Array.isArray(sample.location)) {
      updatePayload.location = {
        ...sample.location,
        status: 'Quarantine',
        area: 'Quarentena'
      };
    } else {
      updatePayload.locationStatus = 'Quarantine';
    }

    await samplesCollection.updateOne(
      { _id: sample._id },
      { $set: updatePayload },
      queryOptions
    );

    await quarantineActionService.recordAction(db, {
      specimenIds: [sampleId],
      reasonCodes: [context.coldChainIncidentId ? 'COLD_CHAIN_INCIDENT' : (context.source || 'AUTOMATIC')],
    }, context.session);

    quarantined += 1;

    const quantitySnapshot = Number(sample.currentQuantity ?? sample.quantity ?? 0);
    const movementID = await SampleMovementModel.generateMovementID(db);

    await appendMovementWithHashChain(
      movementsCollection,
      SampleMovementModel.create({
        movementID,
        sampleID: sampleId,
        barcode: sample.barcode || null,
        type: 'adjust',
        quantity: quantitySnapshot,
        unit: sample.unit || 'µL',
        responsible: 'SYSTEM',
        destination: 'Quarentena',
        purpose: context.coldChainIncidentId ? 'cold_chain_incident_quarantine' : 'sensor_equipment_quarantine',
        linkedProject: sample.linkedProject || null,
        observations: context.reason || 'Quarentena automática por falha de equipamento/sensor',
        userId: context.auditInfo?.userId || null,
        userName: context.auditInfo?.userName || 'SYSTEM',
        userRole: context.auditInfo?.userRole || null,
        ipAddress: context.auditInfo?.ipAddress || null,
        userAgent: context.auditInfo?.userAgent || null,
        previousQuantity: quantitySnapshot,
        newQuantity: quantitySnapshot
      }),
      context.session ? { session: context.session } : {}
    );

    movements += 1;
  }

  return {
    matched: samples.length,
    quarantined,
    movements
  };
}

async function quarantineByEquipmentStatus(db, equipmentContext, newStatus, options = {}) {
  if (!isQuarantineTriggerStatus(newStatus)) {
    return { triggered: false, matched: 0, quarantined: 0, movements: 0 };
  }

  const boxIds = await findBoxIdsByEquipment(db, equipmentContext, options);
  const filter = buildSampleFilterFromBoxIds(boxIds);
  const sourceId = equipmentContext?.equipmentID || equipmentContext?._id || equipmentContext?.id || null;
  const reason = buildStatusChangeReason('equipment', sourceId, newStatus);

  const result = await quarantineSamplesByFilter(db, filter, {
    ...options,
    source: 'equipment',
    sourceId: sourceId ? String(sourceId) : null,
    reason
  });

  logger.warn('[QUARANTINE][EQUIPMENT] Amostras quarentenadas por status do equipamento', {
    sourceId,
    newStatus,
    matched: result.matched,
    quarantined: result.quarantined,
    movements: result.movements
  });

  return {
    triggered: true,
    ...result,
    reason,
    boxIds
  };
}

/**
 * #464: `sensorContext.locationId`/`locationID` (and `options.updateData`'s
 * mirror fields) are the same equipment-level identifier findBoxIdsBySensorKey
 * resolves — not a `locations` document id.
 */
async function quarantineBySensorStatus(db, sensorContext, newStatus, options = {}) {
  if (!isQuarantineTriggerStatus(newStatus)) {
    return { triggered: false, matched: 0, quarantined: 0, movements: 0 };
  }

  const equipmentCandidates = collectIdentifierValues(
    sensorContext?.locationId,
    sensorContext?.locationID,
    options?.updateData?.locationId,
    options?.updateData?.locationID
  );

  const freezers = await resolveFreezersByEquipmentIdentifiers(db, equipmentCandidates, options);
  const boxIds = [];
  for (const freezer of freezers) {
    boxIds.push(...await findBoxIdsUnderFreezer(db, freezer._id, options));
  }
  const dedupedBoxIds = dedupeIds(boxIds);

  const filter = buildSampleFilterFromBoxIds(dedupedBoxIds);
  const sourceId = sensorContext?.sensorId || sensorContext?.sensorID || sensorContext?._id || null;
  const reason = buildStatusChangeReason('sensor', sourceId, newStatus);

  const result = await quarantineSamplesByFilter(db, filter, {
    ...options,
    source: 'sensor',
    sourceId: sourceId ? String(sourceId) : null,
    reason
  });

  logger.warn('[QUARANTINE][SENSOR] Amostras quarentenadas por status do sensor', {
    sourceId,
    newStatus,
    matched: result.matched,
    quarantined: result.quarantined,
    movements: result.movements
  });

  return {
    triggered: true,
    ...result,
    reason,
    boxIds: dedupedBoxIds
  };
}

async function quarantineByColdChainIncident(db, incident = {}, options = {}) {
  const sensorKey = normalizeString(incident.sensorKey || incident.sensorId || incident.sensorID);
  if (!sensorKey) {
    return { triggered: false, matched: 0, quarantined: 0, movements: 0, reason: 'missing-sensor-key' };
  }

  const status = normalizeStatus(incident.status || 'open');
  if (!['open', 'acknowledged', 'escalated'].includes(status)) {
    return { triggered: false, matched: 0, quarantined: 0, movements: 0, reason: 'incident-not-active' };
  }

  const boxIds = await findBoxIdsBySensorKey(db, sensorKey, options);
  const filter = buildSampleFilterFromBoxIds(boxIds);
  const incidentId = incident?._id ? String(incident._id) : sensorKey;
  const reason = buildColdChainIncidentReason(incident);

  const result = await quarantineSamplesByFilter(db, filter, {
    ...options,
    source: 'cold_chain_incident',
    sourceId: incidentId,
    reason,
    coldChainIncidentId: incidentId,
    coldChainSensorKey: sensorKey,
  });

  logger.warn('[QUARANTINE][COLD_CHAIN] Amostras quarentenadas por incidente de cadeia fria', {
    incidentId,
    sensorKey,
    matched: result.matched,
    quarantined: result.quarantined,
    movements: result.movements,
    boxIds
  });

  return {
    triggered: true,
    ...result,
    reason,
    boxIds,
    incidentId,
    sensorKey
  };
}

async function markColdChainIncidentSamplesForReview(db, incident = {}, options = {}) {
  const incidentId = incident?._id ? String(incident._id) : normalizeString(incident.sensorKey || incident.sensorId || incident.sensorID);
  if (!incidentId) {
    return { matched: 0, modified: 0, reviewRequired: false };
  }

  const samplesCollection = await getCollection(db, 'samples');
  const now = new Date();
  const queryOptions = options.session ? { session: options.session } : undefined;
  const matchFilter = {
    coldChainIncidentId: incidentId,
    quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
    specimenStatus: 'quarantined'
  };
  const matchedSamples = await samplesCollection.find(matchFilter, queryOptions).toArray();

  const result = await samplesCollection.updateMany(
    matchFilter,
    {
      $set: {
        coldChainStatus: 'INCIDENT_RESOLVED_REVIEW_REQUIRED',
        coldChainReviewRequired: true,
        coldChainIncidentResolvedAt: now,
        updatedAt: now
      }
    },
    queryOptions
  );

  for (const sample of matchedSamples) {
    await quarantineActionService.markPendingReview(db, String(sample._id), options.session);
  }

  logger.warn('[QUARANTINE][COLD_CHAIN] Incidente resolvido; amostras mantidas para revisão pós-incidente', {
    incidentId,
    matched: result.matchedCount || 0,
    modified: result.modifiedCount || 0
  });

  return {
    matched: result.matchedCount || 0,
    modified: result.modifiedCount || 0,
    reviewRequired: true,
    incidentId
  };
}

module.exports = {
  isQuarantineTriggerStatus,
  quarantineByEquipmentStatus,
  quarantineBySensorStatus,
  quarantineByColdChainIncident,
  markColdChainIncidentSamplesForReview,
  findBoxIdsBySensorKey
};
