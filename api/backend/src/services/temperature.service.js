const TemperatureModel = require('../models/Temperature');
const logger = require('../utils/logger');
const influxTelemetryWriteRepository = require('../infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const influxTelemetryReadRepository = require('../infrastructure/persistence/influxdb/InfluxTelemetryReadRepository');
const notificationServiceV2 = require('./NotificationService');
const notificationDispatchService = require('./notificationDispatch.service');
const { applyOrganizationScopeFilter } = require('./rbac-assignment.service');
// #1079/#1142: the alert-episode helpers filter on { sensorId, type, status },
// so every alert writer has to emit a `type` for them to reach it. The
// scheduler owns missing/stale readings; this module owns the threshold
// breach.
const { ALERT_TYPES, resolveActiveAlert, ensureActiveAlert } = require('./alertLifecycle.service');
const { readingIdentityOf, screenReading, findClientReplay, recordClientReplay } = require('./telemetryReadingContract');

// RULE-025, RF009 AC8 (#1582): the reading contract of POST
// /api/temperature/reading and /api/temperature/system/reading, the top-level
// fields this path reads: TemperatureModel.validate and create, the alert
// policy, and the reading identity's client keys. Any other field is stripped
// at receipt, before hash, screen and store. `temperature` is not one:
// TemperatureModel requires temperatureValue, and nothing here reads it.
const TEMPERATURE_API_READING_FIELDS = Object.freeze([
  'logId', 'logID', 'timestamp', 'sensorId', 'sensorID', 'sensorName', 'sensorModel', 'sensorType',
  'locationId', 'locationID', 'locationName', 'facility', 'zone',
  'temperatureValue', 'temperatureUnit', 'precision', 'minThreshold', 'maxThreshold', 'targetTemperature',
  'hysteresis', 'alertDelay', 'readingStatus', 'sensorStatus', 'signalQuality', 'batteryLevel',
  'errorCode', 'errorMessage', 'lastCalibration', 'nextCalibration', 'calibrationCertificate',
  'maintenanceStatus', 'dataQualityScore', 'operatorId', 'organizationId',
  'policyId', 'policyID',
  'idempotencyKey', 'sourceEventId', 'deviceMessageId', 'traceId', 'sequenceNumber',
]);

// RF009 AC7 (#1317, #1391): a replay answers the first reading's resultRef
// from RF029's key store, which holds identifiers and times, never the value.
function replayOf(resultRef, temperatureData, identity) {
  return {
    ...resultRef,
    sensorId: temperatureData.sensorId ?? temperatureData.sensorID,
    idempotencyKey: identity.idempotencyKey,
    idempotencyKeySource: 'client',
    replayed: true
  };
}

// A point carries no organizationId, so an org-scoped caller is scoped to
// their organizations' sensors: null (unscoped) unless the scope is
// 'organization', else the sensorIds of those organizations' sensors.
async function scopedSensorIdsOf(db, organizationScope) {
  if (organizationScope?.scope !== 'organization') return null;
  const orgIds = organizationScope.organizationIds || [];
  const sensors = (await db.collection('sensors').find({ organizationId: { $in: orgIds } }).toArray())
    .filter((sensor) => orgIds.includes(sensor.organizationId));
  return [...new Set(sensors.map((sensor) => sensor.sensorId).filter(Boolean).map(String))];
}

function createTemperatureValidationError(message, statusCode = 422) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

// #636: mirrors sample.service.js's/sensor.service.js's own organizationId
// validation -- when provided, it must resolve to a real Organization.
async function assertOrganizationIdResolves(db, organizationId) {
  if (organizationId === undefined || organizationId === null || organizationId === '') {
    return;
  }
  const organization = await db.collection('organizations').findOne({ organizationId: String(organizationId) });
  if (!organization) {
    const error = createTemperatureValidationError(`organizationId ${organizationId} não encontrado`, 404);
    // #1120: named for the machine-ingest rejection audit row.
    error.auditReason = 'unknown_organization';
    throw error;
  }
}

/**
 * Service de Temperatura
 * RF009 - Registro de Temperatura e Alertas
 */
class TemperatureService {
  // RULE-025 (#1582): temperatureData holds contract fields only; the names
  // of the fields stripped from it at receipt flag the reading.
  async createTemperatureReading(db, temperatureData, { strippedFields = [] } = {}) {
    try {
      const validation = TemperatureModel.validate(temperatureData);
      if (!validation.isValid) {
        const error = new Error(validation.errors.join(', '));
        // #1120: the MQTT sibling's token for the same condition.
        error.auditReason = 'invalid_payload';
        // RNF018 (#1300): a validation failure answers 422.
        error.statusCode = 422;

        error.details = validation.errors;
        throw error;
      }
      const identity = readingIdentityOf(temperatureData);
      await assertOrganizationIdResolves(db, temperatureData.organizationId);

      // RF009 AC7 (#1317, #1391): a client key already recorded for this
      // sensor in RF029's key store is a replay; it returns the first
      // reading's resultRef and writes nothing.
      const prior = await findClientReplay(db, identity, temperatureData);
      if (prior) return replayOf(prior, temperatureData, identity);

      // RF009 AC7 (#1317): a clock drift or an implausible value is recorded
      // as a TelemetryValidationIssue; an implausible value is a 422 with
      // nothing stored.
      await screenReading(db, identity, temperatureData, { strippedFields });

      const temperature = { ...TemperatureModel.create(temperatureData), ...identity };

      // RF009 AC1, RNF016 C3 (#1317, #1391): InfluxDB is the reading's only
      // store, and its confirmation is persistedAt (V2E-0550). A failed write
      // stores nothing and answers 503. The alert check runs either way: cold-chain
      // availability wins over refusing a reading (the ingest audit's Axis E
      // decision), so an InfluxDB outage never silences an excursion.
      let notPersisted = null;
      try {
        temperature.persistedAt = await influxTelemetryWriteRepository.writeTemperatureReadingNow(temperature);
      } catch (error) {
        notPersisted = Object.assign(new Error(`Leitura não persistida no InfluxDB: ${error.message || error}`), {
          statusCode: 503,
          code: 'TELEMETRY_NOT_PERSISTED',
          auditReason: 'telemetry_not_persisted'
        });
      }

      // Verifica política e gera alerta se necessário
      if (temperatureData.policyId || temperatureData.policyID) {
        await this.checkPolicyAndAlert(db, temperature);
      }
      if (notPersisted) throw notPersisted;

      // RF009 AC7 (#1391): persisted, so the client key now replays this
      // reading. A concurrent send that recorded the key first wins: this one
      // answers the winner's reading.
      const winner = await recordClientReplay(db, identity, temperatureData, temperature.persistedAt);
      if (winner) return replayOf(winner, temperatureData, identity);

      logger.info('Leitura de temperatura registrada:', { telemetryReadingId: temperature.telemetryReadingId });

      return temperature;
    } catch (error) {
      logger.error('Erro ao criar leitura de temperatura:', error.message);
      throw error;
    }
  }

  async checkPolicyAndAlert(db, temperature) {
    try {
      // #1089: was db.collection('policies'), the store the six CRUD
      // routes wrote and nothing on the telemetry side read. Both sides
      // now resolve the same canonical collection.
      const policiesCollection = db.collection('temperaturePolicies');
      const policyId = temperature.policyId || temperature.policyID;

      if (!policyId) {
        return;
      }

      // Busca por policyId (String) ou _id
      const policy = await policiesCollection.findOne({ $or: [{ policyId }, { _id: policyId }] });

      if (!policy) {
        return;
      }

      // Usa thresholds da policy se não estiverem no temperature
      // #1089: the reading still carries its own legacy-named overrides;
      // the POLICY's bounds are canonical (dict-02 lowerLimit/upperLimit).
      const minThreshold = temperature.minThreshold || policy.minTemp;
      const maxThreshold = temperature.maxThreshold || policy.maxTemp;

      // #1198: the limits are Celsius, so the reading is converted for the
      // comparison only.
      const isValid = TemperatureModel.validateReading(
        TemperatureModel.toCelsius(temperature.temperatureValue, temperature.temperatureUnit),
        minThreshold,
        maxThreshold
      );

      if (!isValid) {
        // Gera alerta
        const alertsCollection = db.collection('alerts');

        // #1118: split from #1079. That commit gave this document a `type`
        // so the scheduler's lifecycle helpers COULD match it, and wired the
        // resolve half below -- but left this insert unconditional, so an
        // out-of-range episode still wrote one row per reading. A freezer out
        // of range for a day at a one-minute poll is 1,440 of them, and since
        // #1079 bounded getActiveAlerts at `limit || 1000` one sustained
        // excursion can fill the entire default page and push every other
        // sensor's alert off it.
        //
        // ensureActiveAlert is the scheduler's own episode check, shared
        // through alertLifecycle.service since #1142 rather than copied here.
        //
        // Shape 1 of the three the issue lists: the ROW is deduped, the
        // operator is NOT. Both notifications still fire on every breaching
        // reading -- silencing an operator who missed the first alert while a
        // cold-chain excursion continues is a safety decision, and RF009 AC#6
        // requires an alert without saying how often. #1079's own canonical
        // sibling (iot.controller#upsertEnvironmentalExcursion) is
        // episode-shaped, which is evidence for deduping the row and says
        // nothing about notification cadence.
        const alertPayload = {
          sensorId: temperature.sensorId || temperature.sensorID,
          // #1062: an alert carried no organizationId at all, so
          // GET /alerts could not be scoped by adding middleware -- the
          // filter would have matched nothing. Stamped from the reading,
          // whose own organizationId is server-resolved as of #1071 rather
          // than taken from the request body. Same treatment #634/#635/#636
          // gave Sensor, Equipment and Temperature: stamp new rows, null on
          // anything that predates it, no backfill.
          organizationId: temperature.organizationId || null,
          // #1079: written without a `type` this document could never be
          // matched by the scheduler's resolveActiveAlert, so a threshold
          // breach stayed `active` forever -- one permanent document per
          // out-of-range reading, with nothing in the repo setting
          // status: 'resolved' on it.
          type: ALERT_TYPES.THRESHOLD_BREACH,
          policyId: policyId,
          temperatureValue: temperature.temperatureValue,
          threshold: {
            min: minThreshold,
            max: maxThreshold
          },
          timestamp: new Date(),
          severity: 'warning',
          status: 'active',
          createdAt: new Date()
        };

        // Reuse the open episode's id when we skip the insert. Nothing in
        // src/ reads sourceEventId back -- it is written by seven call sites
        // and stored at notificationDispatch.service.js:159, and queried by
        // none -- so reusing it breaks no consumer, and RF015 AC#6 ("vincular
        // a notificação ao evento que a originou") still holds because the
        // episode's alert IS the originating event.
        const { alertId: activeAlertId } = await ensureActiveAlert(alertsCollection, alertPayload);

        logger.warn('Alerta de temperatura gerado:', {
          sensorId: temperature.sensorId || temperature.sensorID,
          value: temperature.temperatureValue
        });

        void notificationServiceV2.sendCriticalTempAlert(
          temperature.sampleId || temperature.sampleID || 'N/A',
          temperature.temperatureValue
        ).catch((error) => {
          logger.error('[NOTIFICATION] Falha ao disparar alerta crítico:', error.message || error);
        });

        // #646 Wave 3 (RF015/RNF026): fire-and-forget, same shape as the
        // legacy sendCriticalTempAlert call above -- a missing/misconfigured
        // NotificationRule (or a downed email provider) must never block or
        // delay the alert being recorded. No-ops cleanly when no active
        // NotificationRule exists for 'environmental_excursion' yet.
        void notificationDispatchService.dispatchNotification(db, {
          eventType: 'environmental_excursion',
          sourceEventType: 'TemperatureAlert',
          sourceEventId: activeAlertId,
          payload: {
            sensorId: temperature.sensorId || temperature.sensorID,
            temperatureValue: temperature.temperatureValue,
            minThreshold,
            maxThreshold
          }
        }).catch((error) => {
          logger.error('[NOTIFICATION_DISPATCH] Falha ao disparar notificação baseada em regra:', error.message || error);
        });
      } else {
        // #1079: the mirror of the insert above. scheduler.service.js
        // resolves its own two types the moment the good condition holds
        // (checkStaleTemperatureReadings, the `else` beside its isStale
        // branch), with no debounce or hysteresis; this matches that
        // semantics deliberately rather than inventing a second one -- and
        // since #1142 it is the same function.
        const sensorId = temperature.sensorId || temperature.sensorID;
        if (sensorId) {
          await resolveActiveAlert(db.collection('alerts'), sensorId, ALERT_TYPES.THRESHOLD_BREACH);
        }
      }
    } catch (error) {
      logger.error('Erro ao verificar política:', error.message);
    }
  }

  async getTemperatureHistory(db, filters = {}) {
    try {
      // RF009 AC1 (#1317): readings live in InfluxDB, so the history reads
      // both measurements through temperatureReport, not the Mongo
      // `temperatures` copy. A point carries no organizationId, so an
      // org-scoped caller sees the readings of their organizations' sensors
      // (filtered again in JS: the test fakes do not apply queries). An
      // invalid date answers empty, as the Mongo read matched nothing there,
      // and temperatureReport answers an empty window or sensor set empty.
      const limit = Number.isInteger(filters.limit) && filters.limit > 0 ? filters.limit : 1000;
      const skip = Number.isInteger(filters.skip) && filters.skip >= 0 ? filters.skip : 0;

      const start = filters.startDate ? new Date(filters.startDate) : null;
      // A Flux stop is exclusive, where the Mongo read's endDate was $lte.
      const stop = filters.endDate ? new Date(new Date(filters.endDate).getTime() + 1) : null;
      if ((start && Number.isNaN(start.getTime())) || (stop && Number.isNaN(stop.getTime()))) {
        return { temperatures: [], total: 0, limit, skip };
      }

      let sensorIds = await scopedSensorIdsOf(db, filters.organizationScope);

      // #917: `filters.sensorID` is a live input alias (the frontend's api.ts
      // sends it as a query param), so the coalesce stays.
      const sensorIdValue = filters.sensorId || filters.sensorID;
      if (sensorIdValue) {
        sensorIds = sensorIds ? sensorIds.filter((id) => id === String(sensorIdValue)) : [String(sensorIdValue)];
      }

      const { rows, total } = await influxTelemetryReadRepository.temperatureReport({
        start, stop, sensorIds, critical: null, limit, offset: skip
      });

      return { temperatures: rows, total, limit, skip };
    } catch (error) {
      logger.error('Erro ao buscar histórico de temperatura:', error.message);
      throw error;
    }
  }

  // RF009 AC1 (#1391): a reading lives in InfluxDB, so it is read there by
  // its telemetryReadingId. inScope is false for an org-scoped caller unless
  // the reading's sensor is one of their organizations' (a reading with no
  // sensorId is out of scope). An InfluxDB outage rejects.
  async getReadingById(db, telemetryReadingId, organizationScope) {
    const reading = await influxTelemetryReadRepository.readingById(telemetryReadingId);
    if (!reading) return null;
    const sensorIds = await scopedSensorIdsOf(db, organizationScope);
    return {
      reading,
      inScope: sensorIds === null || (reading.sensorId != null && sensorIds.includes(String(reading.sensorId)))
    };
  }

  async getActiveAlerts(db, filters = {}) {
    try {
      if (!db) {
        // Se o banco não está disponível, retorna array vazio
        return [];
      }
      const alertsCollection = db.collection('alerts');
      // #1062: this was the one read in temperature.routes.js without
      // requireOrganizationScope, and it served every organization's active
      // alerts -- sensorId, the breaching value and the configured
      // thresholds -- to every viewTemperature holder.
      // Fail CLOSED on a missing scope. The sibling getTemperatureHistory
      // guards its own filter with `if (filters.organizationScope)`, which
      // degrades OPEN -- drop the middleware from that route and it silently
      // serves every organization again. #1062's body names that as the
      // module's real weakness, so this one refuses instead of widening.
      if (!filters.organizationScope) {
        logger.error('getActiveAlerts chamado sem organizationScope; recusando (fail-closed)');
        return [];
      }
      const query = applyOrganizationScopeFilter({ status: 'active' }, filters.organizationScope, 'organizationId');
      // #1079: this read was unbounded -- no limit, no projection, a
      // toArray() over a collection that (before the auto-resolve above)
      // only ever grew. Mirrors getTemperatureHistory's own
      // `filters.limit || 1000` convention rather than inventing a second.
      const limit = filters.limit || 1000;
      const alerts = await alertsCollection
        .find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return alerts;
    } catch (error) {
      // Em caso de erro (ex: IoT/sensores offline), retorna array vazio
      logger.error('Erro ao buscar alertas:', error.message);
      return [];
    }
  }
}

module.exports = new TemperatureService();
module.exports.TEMPERATURE_API_READING_FIELDS = TEMPERATURE_API_READING_FIELDS;

