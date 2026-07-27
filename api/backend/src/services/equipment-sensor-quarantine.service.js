const { ObjectId } = require('mongodb');
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

function collectLocationIds(...values) {
  const ids = [];
  values.forEach((value) => {
    if (Array.isArray(value)) {
      ids.push(...collectLocationIds(...value));
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

async function findLocationIdsBySensorKey(db, sensorKey, options = {}) {
  const rawSensorKey = normalizeString(sensorKey);
  if (!rawSensorKey) return [];

  const sessionOptions = options.session ? { session: options.session } : undefined;
  const locationIds = [];

  try {
    const sensorsCollection = db.collection('sensors');
    const sensors = await sensorsCollection.find(buildSensorLookup(rawSensorKey), sessionOptions).toArray();
    sensors.forEach((sensor) => {
      locationIds.push(...collectLocationIds(sensor.locationId, sensor.locationID, sensor.storageLocation?.locationID));
    });
  } catch (error) {
    logger.warn('[QUARANTINE][COLD_CHAIN] Não foi possível consultar sensors para incidente', { sensorKey: rawSensorKey, error: error.message });
  }

  try {
    const sensorMetadataCollection = db.collection('sensorMetadata');
    const metadataDocs = await sensorMetadataCollection.find(buildSensorLookup(rawSensorKey), sessionOptions).toArray();

    for (const metadata of metadataDocs) {
      locationIds.push(...collectLocationIds(metadata.locationId, metadata.locationID, metadata.storageLocation?.locationID));
      const equipment = await findEquipmentByMetadata(db, metadata, options);
      if (equipment) {
        locationIds.push(...await findLocationIdsByEquipment(db, equipment, options));
      }
    }
  } catch (error) {
    logger.warn('[QUARANTINE][COLD_CHAIN] Não foi possível consultar sensorMetadata para incidente', { sensorKey: rawSensorKey, error: error.message });
  }

  try {
    const locationsCollection = db.collection('locations');
    const locations = await locationsCollection.find({
      $or: [
        { sensorId: rawSensorKey },
        { sensorID: rawSensorKey },
        { sensorKey: rawSensorKey },
        { 'sensor.sensorId': rawSensorKey },
        { 'sensor.sensorID': rawSensorKey },
      ]
    }, sessionOptions).toArray();
    locationIds.push(...locations.map((location) => location.locationID));
  } catch (error) {
    logger.warn('[QUARANTINE][COLD_CHAIN] Não foi possível consultar locations por sensor', { sensorKey: rawSensorKey, error: error.message });
  }

  return collectLocationIds(locationIds);
}

function buildSampleFilterFromLocationIds(locationIds = []) {
  if (!Array.isArray(locationIds) || locationIds.length === 0) {
    return null;
  }

  const normalizedIds = collectLocationIds(locationIds);

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
      availabilityStatus: 'BLOCKED',
      quarantineStatus: 'QUARANTINED',
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

  const locationCandidates = collectLocationIds(
    sensorContext?.locationId,
    sensorContext?.locationID,
    options?.updateData?.locationId,
    options?.updateData?.locationID
  );

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

async function quarantineByColdChainIncident(db, incident = {}, options = {}) {
  const sensorKey = normalizeString(incident.sensorKey || incident.sensorId || incident.sensorID);
  if (!sensorKey) {
    return { triggered: false, matched: 0, quarantined: 0, movements: 0, reason: 'missing-sensor-key' };
  }

  const status = normalizeStatus(incident.status || 'open');
  if (!['open', 'acknowledged', 'escalated'].includes(status)) {
    return { triggered: false, matched: 0, quarantined: 0, movements: 0, reason: 'incident-not-active' };
  }

  const locationIds = await findLocationIdsBySensorKey(db, sensorKey, options);
  const filter = buildSampleFilterFromLocationIds(locationIds);
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
    locationIds
  });

  return {
    triggered: true,
    ...result,
    reason,
    locationIds,
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
  const result = await samplesCollection.updateMany(
    {
      coldChainIncidentId: incidentId,
      quarantineReasonCode: 'COLD_CHAIN_INCIDENT',
      release_status: 'QUARANTINE'
    },
    {
      $set: {
        availabilityStatus: 'PENDING_REVIEW',
        quarantineStatus: 'PENDING_REVIEW',
        coldChainStatus: 'INCIDENT_RESOLVED_REVIEW_REQUIRED',
        coldChainReviewRequired: true,
        coldChainIncidentResolvedAt: now,
        updatedAt: now
      }
    },
    queryOptions
  );

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
  findLocationIdsBySensorKey
};
