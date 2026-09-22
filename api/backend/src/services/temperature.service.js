const TemperatureModel = require('../models/Temperature');
const PolicyModel = require('../models/Policy');
const logger = require('../utils/logger');
const influxTelemetryWriteRepository = require('../infrastructure/persistence/influxdb/InfluxTelemetryWriteRepository');
const notificationServiceV2 = require('./NotificationService');
const notificationDispatchService = require('./notificationDispatch.service');
const { applyOrganizationScopeFilter } = require('./rbac-assignment.service');

// #1079: scheduler.service.js's resolveActiveAlert/ensureActiveAlert both
// filter on { sensorId, type, status }, so every alert writer has to emit a
// `type` for those two lifecycle helpers to reach it. The scheduler owns
// 'missing_reading' and 'stale_reading'; this module owns the threshold
// breach.
const THRESHOLD_BREACH_ALERT_TYPE = 'threshold_breach';

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
    throw createTemperatureValidationError(`organizationId ${organizationId} não encontrado`, 404);
  }
}

/**
 * Service de Temperatura
 * RF009 - Registro de Temperatura e Alertas
 */
class TemperatureService {
  async createTemperatureReading(db, temperatureData) {
    try {
      const validation = TemperatureModel.validate(temperatureData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }
      await assertOrganizationIdResolves(db, temperatureData.organizationId);

      const temperaturesCollection = db.collection('temperatures');
      const temperature = TemperatureModel.create(temperatureData);

      // Verifica política e gera alerta se necessário
      if (temperatureData.policyId || temperatureData.policyID) {
        await this.checkPolicyAndAlert(db, temperature);
      }

      const result = await temperaturesCollection.insertOne(temperature);

      void Promise.resolve().then(() => {
        influxTelemetryWriteRepository.enqueueTemperatureReading({
          _id: result.insertedId,
          ...temperature
        });
      });

      logger.info('Leitura de temperatura registrada:', { logID: result.insertedId });

      return {
        _id: result.insertedId,
        ...temperature
      };
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

      const isValid = TemperatureModel.validateReading(
        temperature.temperatureValue,
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
        // The filter is scheduler.service.js#ensureActiveAlert's own, rather
        // than a second predicate for the same question. It is duplicated
        // rather than imported for the reason the resolve half below already
        // records: importing that module would pull node-cron and three
        // unrelated services into every caller of this one.
        //
        // Shape 1 of the three the issue lists: the ROW is deduped, the
        // operator is NOT. Both notifications still fire on every breaching
        // reading -- silencing an operator who missed the first alert while a
        // cold-chain excursion continues is a safety decision, and RF009 AC#6
        // requires an alert without saying how often. #1079's own canonical
        // sibling (iot.controller#upsertEnvironmentalExcursion) is
        // episode-shaped, which is evidence for deduping the row and says
        // nothing about notification cadence.
        const existingAlert = await alertsCollection.findOne({
          sensorId: temperature.sensorId || temperature.sensorID,
          type: THRESHOLD_BREACH_ALERT_TYPE,
          status: 'active'
        });

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
          type: THRESHOLD_BREACH_ALERT_TYPE,
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
        const activeAlertId = existingAlert
          ? existingAlert._id
          : (await alertsCollection.insertOne(alertPayload)).insertedId;

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
        // semantics deliberately rather than inventing a second one.
        // Kept inline rather than importing scheduler.service, which would
        // pull node-cron and three unrelated services into every caller of
        // this module for one updateMany.
        const sensorId = temperature.sensorId || temperature.sensorID;
        if (sensorId) {
          const alertsCollection = db.collection('alerts');
          await alertsCollection.updateMany(
            { sensorId, type: THRESHOLD_BREACH_ALERT_TYPE, status: 'active' },
            { $set: { status: 'resolved', resolvedAt: new Date() } }
          );
        }
      }
    } catch (error) {
      logger.error('Erro ao verificar política:', error.message);
    }
  }

  async getTemperatureHistory(db, filters = {}) {
    try {
      const temperaturesCollection = db.collection('temperatures');
      const query = {};

      // #917: `filters.sensorID` is a live *input* alias (the frontend's
      // api.ts sends `sensorID` as a query param), so the coalesce stays. What
      // went is the `{ sensorID: sensorIdValue }` query branch this used to
      // pair it with: `TemperatureModel.create` writes `sensorId` only, and
      // always has, so no stored reading ever carried the capitalised key.
      const sensorIdValue = filters.sensorId || filters.sensorID;
      if (sensorIdValue) {
        query.sensorId = sensorIdValue;
      }

      if (filters.startDate || filters.endDate) {
        const dateQuery = {};
        if (filters.startDate) {
          dateQuery.$gte = new Date(filters.startDate);
        }
        if (filters.endDate) {
          dateQuery.$lte = new Date(filters.endDate);
        }
        
        // Busca tanto em timestamp quanto em dateTime (compatibilidade).
        //
        // #917: this used to branch on `query.$or` already existing and, when
        // it did, wrap both into an `$and`. The only thing that ever set
        // `query.$or` before this point was the sensorId/sensorID pair above;
        // now that the sensor filter is a plain key the merge branch is
        // unreachable, and the two conditions compose as sibling keys --
        // `{ sensorId, $or: [...] }` is the same query the `$and` built, one
        // wrapper shallower.
        query.$or = [
          { timestamp: dateQuery },
          { dateTime: dateQuery }
        ];
      }

      // #636 (F3-G09): org-scoped caller sees only readings whose
      // organizationId is one of their scoped organizations. No-op for a
      // 'global' (Administrador) scope. Caller must resolve+attach
      // organizationScope via rbac.js's requireOrganizationScope first.
      if (filters.organizationScope) {
        applyOrganizationScopeFilter(query, filters.organizationScope, 'organizationId');
      }

      const limit = filters.limit || 1000;
      const skip = filters.skip || 0;

      // Tenta ordenar por timestamp, se não existir, ordena por dateTime ou _id
      let sortQuery = { timestamp: -1 };
      try {
        // Verifica se existe pelo menos um documento com timestamp
        const sample = await temperaturesCollection.findOne({ timestamp: { $exists: true } });
        if (!sample) {
          // Se não existe timestamp, tenta dateTime
          const sampleWithDateTime = await temperaturesCollection.findOne({ dateTime: { $exists: true } });
          if (sampleWithDateTime) {
            sortQuery = { dateTime: -1 };
          } else {
            // Se não existe nenhum, ordena por _id (mais recente primeiro)
            sortQuery = { _id: -1 };
          }
        }
      } catch (sortError) {
        // Em caso de erro, usa _id como fallback
        sortQuery = { _id: -1 };
      }

      const temperatures = await temperaturesCollection
        .find(query)
        .sort(sortQuery)
        .limit(limit)
        .skip(skip)
        .toArray();

      const total = await temperaturesCollection.countDocuments(query);

      return { temperatures: temperatures || [], total: total || 0, limit, skip };
    } catch (error) {
      logger.error('Erro ao buscar histórico de temperatura:', error.message);
      throw error;
    }
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

