const SampleMovementModel = require('../models/SampleMovement');
const { appendMovementWithHashChain } = require('../utils/sampleMovementLedger');
const { getCollection } = require('../utils/collectionResolver');
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

function isQuarantineTriggerStatus(value) {
  return QUARANTINE_TRIGGER_STATUSES.has(normalizeStatus(value));
}

function buildStatusChangeReason(source, sourceId, statusValue) {
  const normalizedSource = source === 'sensor' ? 'sensor' : 'equipamento';
  return `Quarentena automática por ${normalizedSource} ${sourceId || 'desconhecido'} com status ${statusValue}`;
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

async function findLocationIdsByEquipment(db, equipmentContext = {}, options = {}) {
  const identifiers = collectEquipmentIdentifiers(equipmentContext);
  if (identifiers.length === 0) {
    return [];
  }

  const locationsCollection = db.collection('locations');
  const sessionOptions = options.session ? { session: options.session } : undefined;

  const numericIds = identifiers
    .map((id) => Number(id))
    .filter((value) => Number.isFinite(value));

  const cursor = locationsCollection.find(
    {
      $or: [
        { equipmentID: { $in: numericIds } },
        { equipmentID: { $in: identifiers } }
      ]
    },
    sessionOptions
  );

  const locations = await cursor.toArray();

  return locations
    .map((location) => location.locationID)
    .filter((locationID) => locationID !== undefined && locationID !== null);
}

function buildSampleFilterFromLocationIds(locationIds = []) {
  if (!Array.isArray(locationIds) || locationIds.length === 0) {
    return null;
  }

  const normalizedIds = [...new Set(locationIds)];

  return {
    $or: [
      { locationID: { $in: normalizedIds } },
      { 'location.locationID': { $in: normalizedIds } }
    ]
  };
}

async function quarantineSamplesByFilter(db, filter, context = {}) {
  if (!filter) {
    return { matched: 0, quarantined: 0, movements: 0 };
  }

  const now = new Date();
  const samplesCollection = await getCollection(db, 'samples');
  const movementsCollection = await getCollection(db, 'sampleMovements');
  const queryOptions = context.session ? { session: context.session } : undefined;

  const samples = await samplesCollection
    .find(
      {
        $and: [
          filter,
          {
            $or: [
              { status: { $ne: 'QUARANTINED' } },
              { currentStatus: { $ne: 'QUARANTINED' } },
              { release_status: { $ne: 'QUARANTINE' } }
            ]
          }
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
    const updatePayload = {
      status: 'QUARANTINED',
      currentStatus: 'QUARANTINED',
      release_status: 'QUARANTINE',
      quarantineLocation: 'Quarentena',
      quarantineReason: context.reason || null,
      quarantineSource: context.source || null,
      quarantineSourceId: context.sourceId || null,
      quarantinedAt: now,
      updatedAt: now
    };

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

    quarantined += 1;

    const quantitySnapshot = Number(sample.availableQuantity ?? sample.quantity ?? 0);
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
        purpose: 'sensor_equipment_quarantine',
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

  const locationIds = await findLocationIdsByEquipment(db, equipmentContext, options);
  const filter = buildSampleFilterFromLocationIds(locationIds);
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
    locationIds
  };
}

async function quarantineBySensorStatus(db, sensorContext, newStatus, options = {}) {
  if (!isQuarantineTriggerStatus(newStatus)) {
    return { triggered: false, matched: 0, quarantined: 0, movements: 0 };
  }

  const locationCandidates = [
    sensorContext?.locationId,
    sensorContext?.locationID,
    options?.updateData?.locationId,
    options?.updateData?.locationID
  ]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => {
      const numberValue = Number(value);
      return Number.isFinite(numberValue) ? numberValue : value;
    });

  const filter = buildSampleFilterFromLocationIds(locationCandidates);
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
    locationIds: locationCandidates
  };
}

module.exports = {
  isQuarantineTriggerStatus,
  quarantineByEquipmentStatus,
  quarantineBySensorStatus
};
