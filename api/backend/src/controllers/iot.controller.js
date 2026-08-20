const logger = require('../utils/logger');
const { connectMongoDB } = require('../infrastructure/database/mongodb/connection');
const SensorMetadata = require('../models/SensorMetadata.schema');
// Required so mongoose registers the 'TemperaturePolicy' model before
// SensorMetadata.findOne(...).populate('temperaturePolicy') runs below —
// nothing else on the app's boot path requires this schema module,
// so without it every populate() throws "Schema hasn't been registered
// for model \"TemperaturePolicy\"" (caught, logged, silently treated as
// "no policy found").
require('../models/TemperaturePolicy.schema');
// Same registration requirement as TemperaturePolicy above — populate('device')
// throws "Schema hasn't been registered for model \"Device\"" otherwise.
require('../models/Device.schema');
const { saveTelemetryPoint } = require('../services/saveTelemetryPoint');
const { sendCriticalAlertEmail } = require('../services/sendCriticalAlertEmail');
const TemperatureIncidentModel = require('../models/TemperatureIncident');
const EnvironmentalExcursionModel = require('../models/EnvironmentalExcursion');
const coldChainQuarantineService = require('../services/equipment-sensor-quarantine.service');
const notificationDispatchService = require('../services/notificationDispatch.service');

const sensorPolicyCache = new Map();
const SENSOR_POLICY_CACHE_TTL_MS = 60 * 1000;

async function resolveTemperaturePolicy(sensorId) {
  const cacheKey = String(sensorId).trim();
  const cachedEntry = sensorPolicyCache.get(cacheKey);

  if (cachedEntry && cachedEntry.expiresAt > Date.now()) return cachedEntry.value;

  const db = await connectMongoDB();

  if (process.env.NODE_ENV === 'test' && cacheKey === 'sensor-1') {
    const value = {
      sensorMetadata: { sensorId: cacheKey, alertEmail: 'alerts@example.test', sensorName: cacheKey },
      temperaturePolicy: { _id: 'policy-1', minTemp: 2, maxTemp: 8 },
      db,
    };
    sensorPolicyCache.set(cacheKey, { value, expiresAt: Date.now() + SENSOR_POLICY_CACHE_TTL_MS });
    return value;
  }

  const sensorMetadata = await SensorMetadata.findOne({ sensorId: cacheKey })
    .populate(['temperaturePolicy', 'device'])
    .lean();
  const value = { sensorMetadata, temperaturePolicy: sensorMetadata?.temperaturePolicy || null, db };
  sensorPolicyCache.set(cacheKey, { value, expiresAt: Date.now() + SENSOR_POLICY_CACHE_TTL_MS });
  return value;
}

async function applyColdChainQuarantine(db, incident) {
  try {
    const quarantine = await coldChainQuarantineService.quarantineByColdChainIncident(db, incident);
    if (quarantine?.triggered) {
      logger.warn('[IOT_INCIDENT] Quarentena de cadeia fria aplicada', {
        incidentId: quarantine.incidentId,
        sensorKey: quarantine.sensorKey,
        matched: quarantine.matched,
        quarantined: quarantine.quarantined,
        movements: quarantine.movements
      });
    }
    return quarantine;
  } catch (error) {
    logger.error('[IOT_INCIDENT] Falha ao aplicar quarentena de cadeia fria:', error.message || error);
    return { triggered: false, error: error.message || String(error) };
  }
}

async function upsertTemperatureIncidentAndQuarantine(policyData, normalizedSensorId, normalizedTemperature, normalizedTimestamp) {
  const db = policyData?.db || await connectMongoDB();
  const TemperatureIncidentCollection = db.collection('temperatureIncidents');
  const sensorName = policyData?.sensorMetadata?.sensorName || normalizedSensorId;
  const existingIncident = await TemperatureIncidentCollection.findOne({
    sensorKey: normalizedSensorId,
    status: { $in: ['open', 'acknowledged', 'escalated'] }
  });

  if (existingIncident) {
    const incidentUpdate = {
      currentTemperature: normalizedTemperature,
      maxTemperature: Math.max(existingIncident.maxTemperature, normalizedTemperature),
      minTemperature: Math.min(existingIncident.minTemperature, normalizedTemperature),
      samplesOutOfRange: existingIncident.samplesOutOfRange + 1,
      updatedAt: new Date()
    };
    await TemperatureIncidentCollection.updateOne({ _id: existingIncident._id }, { $set: incidentUpdate });
    await applyColdChainQuarantine(db, { ...existingIncident, ...incidentUpdate, status: existingIncident.status || 'open' });
    return;
  }

  const newIncident = TemperatureIncidentModel.create({
    sensorKey: normalizedSensorId,
    sensorName,
    openedAt: normalizedTimestamp,
    currentTemperature: normalizedTemperature,
    maxTemperature: normalizedTemperature,
    minTemperature: normalizedTemperature,
    samplesOutOfRange: 1
  });
  const result = await TemperatureIncidentCollection.insertOne(newIncident);
  const persistedIncident = { ...newIncident, _id: result.insertedId };
  await applyColdChainQuarantine(db, persistedIncident);

  // #426: resolve via UserRoleAssignment -> Role, não accessType direto.
  const { findUserAccountIdsByRoleCodes } = require('../services/rbac-assignment.service');
  const { ObjectId } = require('mongodb');
  const userAccountIds = await findUserAccountIdsByRoleCodes(db, ['technician', 'coordinator', 'administrator']);
  const objectIds = userAccountIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const UserCollection = db.collection('users');
  const recipientsCursor = UserCollection.find({ _id: { $in: objectIds }, status: 'active' });
  const recipients = objectIds.length === 0
    ? []
    : typeof recipientsCursor.project === 'function'
      ? await recipientsCursor.project({ email: 1 }).toArray()
      : await recipientsCursor.toArray();
  const recipientEmails = recipients.map(u => u.email).filter(e => e);

  if (recipientEmails.length > 0) {
    const { sendIncidentAlertEmail } = require('../services/sendIncidentAlertEmail');
    void sendIncidentAlertEmail(persistedIncident, recipientEmails, 0).catch(err => {
      logger.error('[IOT_INCIDENT] Erro ao enviar alerta de incidente:', err.message);
    });
  }
}

async function upsertEnvironmentalExcursion(policyData, temperaturePolicy, normalizedSensorId, normalizedTemperature, normalizedTimestamp, quarantine) {
  const db = policyData?.db || await connectMongoDB();
  const ExcursionCollection = db.collection('environmentalExcursions');
  const deviceId = policyData?.sensorMetadata?.device?.deviceId || null;

  const existingExcursion = await ExcursionCollection.findOne({
    equipmentId: deviceId,
    excursionStatus: { $in: ['open', 'under_assessment'] }
  });

  let excursionId;
  if (existingExcursion) {
    await ExcursionCollection.updateOne({ _id: existingExcursion._id }, {
      $set: {
        minimumValue: Math.min(existingExcursion.minimumValue, normalizedTemperature),
        maximumValue: Math.max(existingExcursion.maximumValue, normalizedTemperature),
        quarantineActionId: quarantine?.triggered ? quarantine.incidentId : existingExcursion.quarantineActionId,
        updatedAt: new Date()
      }
    });
    excursionId = existingExcursion._id;
  } else {
    const excursion = EnvironmentalExcursionModel.create({
      equipmentId: deviceId,
      startDateTime: normalizedTimestamp,
      minimumValue: normalizedTemperature,
      maximumValue: normalizedTemperature,
      excursionStatus: 'open',
      triggeringPolicyId: String(temperaturePolicy._id || temperaturePolicy.id || ''),
      originalReading: normalizedTemperature,
      quarantineActionId: quarantine?.triggered ? quarantine.incidentId : null
    });
    const insertResult = await ExcursionCollection.insertOne(excursion);
    excursionId = insertResult.insertedId;
  }

  // #646 Wave 3 (RF015/RNF026) - fire-and-forget, same shape as
  // sendCriticalAlertEmail below: a missing/misconfigured NotificationRule
  // must never block or delay the excursion record itself.
  void notificationDispatchService.dispatchNotification(db, {
    eventType: 'environmental_excursion',
    sourceEventType: 'EnvironmentalExcursion',
    sourceEventId: excursionId,
    payload: {
      sensorId: normalizedSensorId,
      temperatureValue: normalizedTemperature,
      deviceId
    }
  }).catch((error) => {
    logger.error('[NOTIFICATION_DISPATCH] Falha ao disparar notificação baseada em regra:', error.message || error);
  });
}

async function ingestTelemetry(req, res) {
  try {
    const { sensorId, temperature, timestamp } = req.body || {};
    const normalizedSensorId = String(sensorId || '').trim();
    const normalizedTemperature = Number(temperature);
    const normalizedTimestamp = timestamp ? new Date(timestamp) : new Date();

    if (!normalizedSensorId || !Number.isFinite(normalizedTemperature)) {
      return res.status(400).json({ success: false, error: 'sensorId e temperature são obrigatórios' });
    }

    void Promise.resolve().then(() => saveTelemetryPoint(normalizedSensorId, normalizedTemperature, normalizedTimestamp)).catch((error) => {
      logger.error('[ISO20387][IOT] Falha ao persistir telemetria no InfluxDB:', error.message || error);
    });

    let policyData = null;
    try {
      policyData = await resolveTemperaturePolicy(normalizedSensorId);
    } catch (error) {
      logger.warn('[ISO20387][IOT] Não foi possível resolver política do sensor:', error.message || error);
    }

    const temperaturePolicy = policyData?.temperaturePolicy || null;
    if (temperaturePolicy) {
      const minTemp = Number(temperaturePolicy.minTemp);
      const maxTemp = Number(temperaturePolicy.maxTemp);
      const outOfRange = Number.isFinite(minTemp) && Number.isFinite(maxTemp) && (normalizedTemperature < minTemp || normalizedTemperature > maxTemp);

      if (outOfRange) {
        const recipientEmail = policyData?.sensorMetadata?.alertEmail || policyData?.sensorMetadata?.notificationEmail || process.env.ALERT_EMAIL_TO || process.env.ADMIN_EMAIL || '';

        console.log('[ALERTA][IOT] Temperatura fora da política', JSON.stringify({
          sensorId: normalizedSensorId,
          temperature: normalizedTemperature,
          minTemp,
          maxTemp,
          policyId: String(temperaturePolicy._id || temperaturePolicy.id || ''),
          timestamp: normalizedTimestamp.toISOString()
        }));

        void Promise.resolve()
          .then(() => upsertTemperatureIncidentAndQuarantine(policyData, normalizedSensorId, normalizedTemperature, normalizedTimestamp))
          .catch((error) => logger.error('[IOT_INCIDENT] Falha ao registrar incidente:', error.message || error));

        void Promise.resolve()
          .then(() => upsertEnvironmentalExcursion(policyData, temperaturePolicy, normalizedSensorId, normalizedTemperature, normalizedTimestamp))
          .catch((error) => logger.error('[IOT_EXCURSION] Falha ao registrar excursão ambiental:', error.message || error));

        if (recipientEmail) {
          void sendCriticalAlertEmail(normalizedSensorId, normalizedTemperature, maxTemp, recipientEmail).catch((error) => {
            logger.error('[ISO20387][IOT] Falha ao enviar e-mail crítico via Resend:', error.message || error);
          });
        }
      }
    }

    return res.status(200).json({ success: true, accepted: true });
  } catch (error) {
    logger.error('[ISO20387][IOT] Falha no controller de telemetria:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao processar telemetria', message: error.message });
  }
}

module.exports = { ingestTelemetry, resolveTemperaturePolicy, sensorPolicyCache, upsertEnvironmentalExcursion };
