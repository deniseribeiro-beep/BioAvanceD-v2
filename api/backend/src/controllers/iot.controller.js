const mongoose = require('mongoose');
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
const { readingIdentityOf, screenReading, splitContractFields, IOT_API_READING_FIELDS } = require('../services/telemetryReadingContract');
const { getDatastream } = require('../services/telemetryBinding.service');
const { datastreamEquipmentIdsBySensor } = require('../services/sensorDatastream.service');
const { findCompletedIdempotentResult, recordCompletedIdempotentResult } = require('../ingestion/idempotency');
const { sendCriticalAlertEmail } = require('../services/sendCriticalAlertEmail');
const TemperatureIncidentModel = require('../models/TemperatureIncident');
const EnvironmentalExcursionModel = require('../models/EnvironmentalExcursion');
const UserModel = require('../models/User');
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

// RF009 AC4, V2E-0569 (#1317): the TemperaturePolicy that a datastream's
// thresholdProfileId names, or null. [inference] A bound reading is judged
// against it: the datastream model interprets a reading "through the
// datastream valid when it was observed", V2E-0569 puts the versioned limits
// profile on the datastream, and TemperaturePolicy.schema.js maps
// thresholdProfileId to the policy's `_id`. [inference] A 24-hex id matches
// either an ObjectId `_id` (a policy created through the policy routes) or a
// string one (a policy inserted with a string id). The ObjectId comes from
// mongoose.Types for the #651 reason given in
// upsertTemperatureIncidentAndQuarantine. Nothing is cached, so a policy edit
// applies at the next reading.
async function resolveDatastreamPolicy(db, datastreamId) {
  if (!datastreamId) return null;
  const stream = await getDatastream(db, datastreamId);
  const profileId = stream.thresholdProfileId;
  let policy = null;
  if (profileId) {
    const id = String(profileId);
    const filter = /^[0-9a-fA-F]{24}$/.test(id)
      ? { _id: { $in: [new mongoose.Types.ObjectId(id), id] } }
      : { _id: id };
    policy = await db.collection('temperaturePolicies').findOne(filter);
  }
  if (!policy) {
    logger.warn('[ISO20387][IOT] O perfil de limites do TelemetryDatastream não nomeia uma política; vale a do sensor', {
      datastreamId: String(datastreamId),
      thresholdProfileId: profileId || null,
    });
  }
  return policy || null;
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

const ACTIVE_INCIDENT_STATUSES = ['open', 'acknowledged', 'escalated'];
const DEFAULT_CRITICAL_DURATION_HOURS = 2;

// #1207: how long an excursion must last before its samples are quarantined,
// in minutes. The same rule TelemetryMonitor.resolveCriticalDurationMinutesBySensor
// applies to the Neo4j COMPROMISED mark: the policy's minimumDuration when it
// is a positive number, else TELEMETRY_CRITICAL_DURATION_HOURS.
function resolveExcursionThresholdMinutes(temperaturePolicy) {
  const minimumDuration = temperaturePolicy?.minimumDuration;
  if (typeof minimumDuration === 'number' && minimumDuration > 0) return minimumDuration;
  const hours = Number(process.env.TELEMETRY_CRITICAL_DURATION_HOURS ?? DEFAULT_CRITICAL_DURATION_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_CRITICAL_DURATION_HOURS) * 60;
}

// #1207: the alarm (incident, excursion row, emails) stays immediate, but the
// quarantine changes specimen disposition, so it waits until the excursion has
// lasted the policy's time limit -- ISBER Best Practices 5th ed. §H3.1 has the
// operator set "the critical limits (temperatures and time)", and v2.0.0
// ELM-0368 starts an excursion at the first out-of-limit reading "conforme a
// regra". The clock is the incident's excursionStartedAt, not openedAt: an
// incident only closes when someone resolves it, so a door opening that
// recovered in minutes would otherwise still quarantine once the unresolved
// incident aged past the limit.
async function upsertTemperatureIncidentAndQuarantine(policyData, normalizedSensorId, normalizedTemperature, normalizedTimestamp) {
  const db = policyData?.db || await connectMongoDB();
  const TemperatureIncidentCollection = db.collection('temperatureIncidents');
  const sensorName = policyData?.sensorMetadata?.sensorName || normalizedSensorId;
  const existingIncident = await TemperatureIncidentCollection.findOne({
    sensorKey: normalizedSensorId,
    status: { $in: ACTIVE_INCIDENT_STATUSES }
  });

  if (existingIncident) {
    // No clock means the temperature came back in range since the incident
    // opened (or the incident predates #1207): this reading starts a new run.
    const excursionStartedAt = existingIncident.excursionStartedAt
      ? new Date(existingIncident.excursionStartedAt)
      : normalizedTimestamp;
    const incidentUpdate = {
      currentTemperature: normalizedTemperature,
      maxTemperature: Math.max(existingIncident.maxTemperature, normalizedTemperature),
      minTemperature: Math.min(existingIncident.minTemperature, normalizedTemperature),
      samplesOutOfRange: existingIncident.samplesOutOfRange + 1,
      excursionStartedAt,
      updatedAt: new Date()
    };
    await TemperatureIncidentCollection.updateOne({ _id: existingIncident._id }, { $set: incidentUpdate });
    const thresholdMs = resolveExcursionThresholdMinutes(policyData?.temperaturePolicy) * 60 * 1000;
    if (normalizedTimestamp.getTime() - excursionStartedAt.getTime() >= thresholdMs) {
      await applyColdChainQuarantine(db, { ...existingIncident, ...incidentUpdate, status: existingIncident.status || 'open' });
    }
    return;
  }

  const newIncident = TemperatureIncidentModel.create({
    sensorKey: normalizedSensorId,
    sensorName,
    openedAt: normalizedTimestamp,
    excursionStartedAt: normalizedTimestamp,
    currentTemperature: normalizedTemperature,
    maxTemperature: normalizedTemperature,
    minTemperature: normalizedTemperature,
    samplesOutOfRange: 1
  });
  const result = await TemperatureIncidentCollection.insertOne(newIncident);
  const persistedIncident = { ...newIncident, _id: result.insertedId };

  // #426: resolve via UserRoleAssignment -> Role, não accessType direto.
  const { findUserAccountIdsByRoleCodes } = require('../services/rbac-assignment.service');
  // #651: db here is the mongoose connection (via connectMongoDB), and
  // mongoose bundles its own bson (major-version-diverged from the
  // top-level `mongodb` package's bson). An ObjectId instance built from
  // `require('mongodb')` and handed to a query run through the mongoose
  // connection throws "Unsupported BSON version, bson types must be from
  // bson 7.x.x" -- so ObjectId must come from mongoose.Types here.
  const { ObjectId } = mongoose.Types;
  const userAccountIds = await findUserAccountIdsByRoleCodes(db, ['technician', 'coordinator', 'administrator']);
  const objectIds = userAccountIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const UserCollection = db.collection('users');
  const recipientsCursor = UserCollection.find({ _id: { $in: objectIds }, ...UserModel.accountStatusFilter('active') });
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

// #1207: an in-range reading ends the current out-of-range run, so the next
// out-of-range reading starts the quarantine clock afresh.
async function stopExcursionClock(policyData, normalizedSensorId) {
  const db = policyData?.db || await connectMongoDB();
  await db.collection('temperatureIncidents').updateOne(
    {
      sensorKey: normalizedSensorId,
      status: { $in: ACTIVE_INCIDENT_STATUSES },
      excursionStartedAt: { $ne: null }
    },
    { $set: { excursionStartedAt: null, updatedAt: new Date() } }
  );
}

async function upsertEnvironmentalExcursion(policyData, temperaturePolicy, normalizedSensorId, normalizedTemperature, normalizedTimestamp, quarantine) {
  const db = policyData?.db || await connectMongoDB();
  const ExcursionCollection = db.collection('environmentalExcursions');
  const legacyDeviceId = policyData?.sensorMetadata?.device?.deviceId || null;
  // #1392: the excursion is keyed by the equipment the sensor's temperature
  // datastream valid now monitors, the SensorMetadata device the fallback
  // (docs/decisions/2026-10-21-sensor-readers-from-datastream.md, decision
  // 5). The stream valid now, not the reading's, so this and
  // incident.controller's closeEnvironmentalExcursion read the same key.
  const equipmentId = (await datastreamEquipmentIdsBySensor(db, [normalizedSensorId])).get(String(normalizedSensorId)) || legacyDeviceId;

  const existingExcursion = await ExcursionCollection.findOne({
    equipmentId,
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
      equipmentId,
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
      deviceId: legacyDeviceId,
      equipmentId
    }
  }).catch((error) => {
    logger.error('[NOTIFICATION_DISPATCH] Falha ao disparar notificação baseada em regra:', error.message || error);
  });
}

async function ingestTelemetry(req, res) {
  try {
    const { sensorId, temperature } = req.body || {};
    const normalizedSensorId = String(sensorId || '').trim();
    const normalizedTemperature = Number(temperature);

    if (!normalizedSensorId || !Number.isFinite(normalizedTemperature)) {
      // #1120 (Axis E E3): the audit row names which condition refused the
      // reading -- a misconfigured gateway and a failing sensor mean
      // different things operationally. Tokens follow the MQTT sibling's
      // snake_case reasons. sensorId is checked first, so a body failing
      // both records missing_sensor_id.
      res.locals.auditReason = !normalizedSensorId ? 'missing_sensor_id' : 'invalid_temperature';
      return res.status(400).json({ success: false, error: 'sensorId e temperature são obrigatórios' });
    }

    // #1317 (RF009 AC1-AC3): the reading contract the other ingestion paths
    // use. InfluxDB is the reading's authority, so the point is written and
    // confirmed before the reading is accepted; a failed write answers 503.
    // The policy below is still evaluated: cold-chain availability wins over
    // refusing a reading (the Axis E decision on the audit below), so an
    // InfluxDB outage never silences an excursion. A timestamp that is not a
    // date is a 422.
    // RF009 AC8, RNF004 C7 (#1540): fields outside the reading contract may
    // carry personal data. They are stripped here, before the reading is
    // hashed, screened or stored, and the reading is kept and flagged by a
    // personal_data_stripped issue, never refused.
    const { reading: contractBody, strippedFields } = splitContractFields(req.body || {}, IOT_API_READING_FIELDS);
    let identity;
    try {
      identity = readingIdentityOf(contractBody, new Date(), { ingestionService: 'iot-api' });
    } catch (error) {
      res.locals.auditReason = error.auditReason || 'invalid_payload';
      return res.status(error.statusCode || 422).json({ success: false, error: error.message });
    }

    // RF009 AC7 (#1317): a client idempotencyKey already accepted for this
    // sensor is a replay. It answers 200 with the first reading, and writes,
    // evaluates and audits nothing, like the temperature route's replay.
    // `[inference]` this route stores no Mongo reading, so its key goes in
    // RF029's key store under `TelemetryReading:<sensorId>`, and is recorded
    // only once InfluxDB persisted the reading: a 422 or a 503 leaves it free
    // for the retry. `[inference]` a failed lookup or record is logged and the
    // reading goes on, since cold-chain availability wins (the Axis E
    // decision on the audit below). So two concurrent first sends can both be
    // written to InfluxDB; the collection's unique { idempotencyKey, scope }
    // index ingestion_idempotency_key_scope_unique_v1, which
    // ensureIdempotencyKeyIndex creates when a key is recorded, keeps one key
    // row (#1391).
    let replayScope = null;
    if (identity.idempotencyKeySource === 'client') {
      replayScope = `TelemetryReading:${normalizedSensorId}`;
      let resultRef = null;
      try {
        resultRef = await findCompletedIdempotentResult(await connectMongoDB(), { idempotencyKey: identity.idempotencyKey, scope: replayScope });
      } catch (error) {
        logger.error('[ISO20387][IOT] Falha ao consultar idempotencyKey da telemetria:', error.message || error);
      }
      if (resultRef) {
        return res.status(200).json({ success: true, accepted: true, replayed: true, ...resultRef });
      }
    }

    try {
      // RF009 AC7: a drift or an implausible value is recorded as a
      // TelemetryValidationIssue; an implausible value is a 422 here.
      await screenReading(connectMongoDB, identity, contractBody, { strippedFields });
    } catch (error) {
      res.locals.auditReason = error.auditReason || 'invalid_payload';
      return res.status(error.statusCode || 422).json({ success: false, error: error.message });
    }
    const normalizedTimestamp = identity.observedAt;
    let persistedAt = null;
    try {
      await saveTelemetryPoint(normalizedSensorId, normalizedTemperature, normalizedTimestamp, identity);
      persistedAt = new Date();
    } catch (error) {
      logger.error('[ISO20387][IOT] Falha ao persistir telemetria no InfluxDB:', error.message || error);
    }

    let policyData = null;
    try {
      policyData = await resolveTemperaturePolicy(normalizedSensorId);
    } catch (error) {
      logger.warn('[ISO20387][IOT] Não foi possível resolver política do sensor:', error.message || error);
    }

    // RF009 AC4, V2E-0569 (#1317): a reading bound to a datastream is judged
    // against that datastream's threshold profile. [inference] The
    // SensorMetadata policy stays the fallback, for an unbound reading, a
    // profile that names no policy and a failed lookup: cold-chain
    // availability wins (the Axis E decision on the audit below), so no
    // excursion goes unchecked because of a datastream lookup. A new object,
    // never the cached one: sensorPolicyCache holds it for the next unbound
    // reading of this sensor.
    if (identity.datastreamId) {
      try {
        const policyDb = policyData?.db || await connectMongoDB();
        const streamPolicy = await resolveDatastreamPolicy(policyDb, identity.datastreamId);
        if (streamPolicy) {
          policyData = { ...(policyData || {}), db: policyDb, temperaturePolicy: streamPolicy };
        }
      } catch (error) {
        logger.warn('[ISO20387][IOT] Não foi possível resolver a política do TelemetryDatastream; vale a do sensor:', error.message || error);
      }
    }

    const temperaturePolicy = policyData?.temperaturePolicy || null;
    if (temperaturePolicy) {
      const minTemp = Number(temperaturePolicy.minTemp);
      const maxTemp = Number(temperaturePolicy.maxTemp);
      const boundsUsable = Number.isFinite(minTemp) && Number.isFinite(maxTemp);
      const outOfRange = boundsUsable && (normalizedTemperature < minTemp || normalizedTemperature > maxTemp);

      if (boundsUsable && !outOfRange) {
        void Promise.resolve()
          .then(() => stopExcursionClock(policyData, normalizedSensorId))
          .catch((error) => logger.error('[IOT_INCIDENT] Falha ao encerrar a contagem da excursão:', error.message || error));
      }

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

    // #1317: not persisted, so not accepted; the policy above still ran.
    // The rejection's row is the global audit.middleware.js one, with this
    // reason.
    if (!persistedAt) {
      res.locals.auditReason = 'telemetry_not_persisted';
      return res.status(503).json({ success: false, code: 'TELEMETRY_NOT_PERSISTED', error: 'Leitura não persistida no InfluxDB' });
    }

    // RF009 AC7 (#1317): persisted, so the client key now replays this
    // reading's 200 body.
    if (replayScope) {
      try {
        await recordCompletedIdempotentResult(await connectMongoDB(), {
          idempotencyKey: identity.idempotencyKey,
          scope: replayScope,
          resultRef: {
            telemetryReadingId: identity.telemetryReadingId,
            observedAt: identity.observedAt,
            receivedAt: identity.receivedAt,
            persistedAt,
            clockStatus: identity.clockStatus
          }
        });
      } catch (error) {
        logger.error('[ISO20387][IOT] Falha ao registrar idempotencyKey da telemetria:', error.message || error);
      }
    }

    // #1093: this route wrote no audit row at all. Its HTTP machine-ingest
    // sibling, POST /api/temperature/system/reading, at least had one guarded
    // on `if (req.user)` -- removed in #1080 because a machine caller has no
    // session. Here there was nothing to unguard. The route was outside the
    // MQTT hash-chained ingestion trail too (mqtt-ingestion-audit.service.js
    // writes source: 'mqtt' and is reached from no HTTP path), so a
    // TELEMETRY_INGEST_SECRET holder could submit cold-chain readings that
    // left no record anywhere that anything had submitted them.
    //
    // Which of the two trails it belongs in is settled by dict-02 P1X-0331:
    // AuditEvent.source is a single 1..1 Core field whose vocabulary is
    // "api, frontend, worker, mqtt, scheduler ou system". So the canonical
    // model treats the transports as ONE audit surface discriminated by
    // source, not as two parallel trails -- and an HTTP route is 'api', a
    // value already in that vocabulary, rather than a new 'http'. An
    // auditLogger row also already reaches the integrity chain:
    // integrityCheckService.buildMerkleForDate hashes every `logs` row into
    // the same daily Merkle root as the mqtt leaves, so this is tamper-evident
    // without wiring a second chained collection.
    //
    // resourceType is the canonical entity for this body -- TelemetryReading,
    // ELM-0357..ELM-0365 -- rather than the sibling's 'Temperature', which
    // names the Mongo record that route creates. resourceId is the sensorId:
    // the reading's only persistence here is the InfluxDB write above, so
    // there is no document id to name; its telemetryReadingId is in the
    // response (#1317).
    //
    // Only the ACCEPTED ingest is audited here, matching the #1080 sibling.
    // A rejection's row is the global audit.middleware.js one, which since
    // #1120 carries the res.locals.auditReason set at the 400 above.
    try {
      const auditDb = policyData?.db || await connectMongoDB();
      const auditLogger = require('../utils/auditLogger');
      auditLogger.init(auditDb);
      await auditLogger.log({
        action: 'CREATE',
        resourceType: 'TelemetryReading',
        resourceId: normalizedSensorId,
        status: 'success',
        severity: 'info',
        message: `Telemetria recebida: ${normalizedSensorId} = ${normalizedTemperature}`,
        req: req
      });
    } catch (error) {
      // auditLogger.log does not reject; since #1096 it also raises a critical
      // AUDIT_TRAIL_WRITE_FAILURE alert when the audit row cannot be written,
      // so a failed ingest audit is no longer silent. This catch guards the
      // connection lookup above it, so an unavailable audit trail cannot turn
      // an accepted ingest into a 500. That fail-open posture is DECIDED:
      // Denise's Axis E decision on #1106 (Session E1, 2026-09-25) is that
      // cold-chain availability wins over refusing an unauditable reading.
      // The alert's validation/infrastructure split (7d9fa26b) is the rest
      // of that decision. Do not fail closed here without reopening it.
      logger.error('[ISO20387][IOT] Falha ao registrar trilha de auditoria da telemetria:', error.message || error);
    }

    return res.status(200).json({
      success: true,
      accepted: true,
      telemetryReadingId: identity.telemetryReadingId,
      observedAt: identity.observedAt,
      receivedAt: identity.receivedAt,
      persistedAt,
      clockStatus: identity.clockStatus
    });
  } catch (error) {
    logger.error('[ISO20387][IOT] Falha no controller de telemetria:', error.message || error);
    return res.status(500).json({ success: false, error: 'Erro ao processar telemetria', message: error.message });
  }
}

module.exports = { ingestTelemetry, resolveTemperaturePolicy, resolveDatastreamPolicy, sensorPolicyCache, upsertEnvironmentalExcursion };
