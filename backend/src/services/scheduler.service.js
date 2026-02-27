const cron = require('node-cron');
const logger = require('../utils/logger');
const env = require('../config/env');
const backupService = require('./backup.service');
const consentNeo4jSyncService = require('./consentNeo4jSync.service');

const DEFAULT_STALE_MINUTES = 20;

let temperatureTask = null;
let backupTask = null;
let consentSyncTask = null;

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function resolveActiveAlert(alertsCollection, sensorId, type) {
  await alertsCollection.updateMany(
    { sensorId, type, status: 'active' },
    { $set: { status: 'resolved', resolvedAt: new Date() } }
  );
}

async function ensureActiveAlert(alertsCollection, payload) {
  const existing = await alertsCollection.findOne({
    sensorId: payload.sensorId,
    type: payload.type,
    status: 'active'
  });

  if (!existing) {
    await alertsCollection.insertOne(payload);
    return true;
  }

  return false;
}

async function checkStaleTemperatureReadings(db) {
  const sensorsCollection = db.collection('sensors');
  const temperaturesCollection = db.collection('temperatures');
  const alertsCollection = db.collection('alerts');

  const sensors = await sensorsCollection.find({}).toArray();
  if (!sensors.length) {
    return { sensors: 0, alerts: 0 };
  }

  const now = Date.now();
  const staleMinutes = Number(env.TEMP_STALE_MINUTES || DEFAULT_STALE_MINUTES);
  const staleMs = staleMinutes * 60 * 1000;

  let alertsCreated = 0;

  for (const sensor of sensors) {
    const sensorId = sensor.sensorId || sensor.sensorID;
    if (!sensorId) continue;

    const lastReading = await temperaturesCollection.find({
      $or: [{ sensorId }, { sensorID: sensorId }]
    })
      .sort({ timestamp: -1, dateTime: -1, _id: -1 })
      .limit(1)
      .next();

    if (!lastReading) {
      const created = await ensureActiveAlert(alertsCollection, {
        sensorId,
        type: 'missing_reading',
        message: 'Nenhuma leitura registrada para o sensor',
        severity: 'critical',
        status: 'active',
        timestamp: new Date(),
        createdAt: new Date()
      });

      if (created) alertsCreated += 1;
      continue;
    }

    const lastTimestamp = normalizeDate(lastReading.timestamp || lastReading.dateTime || lastReading.createdAt);
    if (!lastTimestamp) continue;

    const isStale = now - lastTimestamp.getTime() > staleMs;

    if (isStale) {
      const created = await ensureActiveAlert(alertsCollection, {
        sensorId,
        type: 'stale_reading',
        message: `Última leitura há mais de ${staleMinutes} minutos`,
        severity: 'warning',
        status: 'active',
        timestamp: new Date(),
        createdAt: new Date(),
        lastReadingAt: lastTimestamp
      });

      if (created) alertsCreated += 1;
    } else {
      await resolveActiveAlert(alertsCollection, sensorId, 'stale_reading');
      await resolveActiveAlert(alertsCollection, sensorId, 'missing_reading');
    }
  }

  return { sensors: sensors.length, alerts: alertsCreated };
}

function startTemperatureMonitor(db) {
  const cronExpr = env.TEMP_MONITOR_CRON || '*/10 * * * *';
  const timezone = process.env.TZ || 'America/Sao_Paulo';

  temperatureTask = cron.schedule(cronExpr, async () => {
    try {
      if (!db) return;
      const result = await checkStaleTemperatureReadings(db);
      logger.info(`🌡️ Monitoramento de temperatura executado: sensores=${result.sensors} alertas=${result.alerts}`);
    } catch (error) {
      logger.error('Erro no monitoramento de temperatura:', error.message);
    }
  }, { timezone });

  logger.info(`⏱️ Monitoramento de temperatura agendado (${cronExpr})`);
}

function startBackupSchedule() {
  const cronExpr = env.BACKUP_CRON || '0 3 * * *';
  const timezone = process.env.TZ || 'America/Sao_Paulo';

  backupTask = cron.schedule(cronExpr, async () => {
    try {
      await backupService.runBackup();
    } catch (error) {
      logger.error('Erro ao executar backup agendado:', error.message);
    }
  }, { timezone });

  logger.info(`🗂️ Backup diário agendado (${cronExpr})`);
}

function startConsentSyncSchedule({ db, neo4jDriver }) {
  if (!env.ENABLE_CONSENT_SYNC) {
    logger.info('🔕 Sincronização Mongo→Neo4j de consentimento desativada (ENABLE_CONSENT_SYNC=false)');
    return;
  }

  const cronExpr = env.CONSENT_SYNC_CRON || '*/30 * * * *';
  const timezone = process.env.TZ || 'America/Sao_Paulo';

  consentSyncTask = cron.schedule(cronExpr, async () => {
    try {
      if (!db || !neo4jDriver) {
        logger.warn('[ISO20387][SYNC] Skip sincronização de consentimento: dependências indisponíveis');
        return;
      }

      const result = await consentNeo4jSyncService.sync({ db, neo4jDriver });
      logger.info(`[ISO20387][SYNC] Job agendado concluído: processadas=${result.processed}, atualizadas=${result.updated}`);
    } catch (error) {
      logger.error('[ISO20387][SYNC] Erro no job agendado de sincronização de consentimento:', error.message || error);
    }
  }, { timezone });

  logger.info(`🧬 Sincronização de consentimento agendada (${cronExpr})`);
}

function initScheduler({ db, neo4jDriver }) {
  startTemperatureMonitor(db);
  startBackupSchedule();
  startConsentSyncSchedule({ db, neo4jDriver });
}

function stopScheduler() {
  if (temperatureTask) temperatureTask.stop();
  if (backupTask) backupTask.stop();
  if (consentSyncTask) consentSyncTask.stop();
}

module.exports = {
  initScheduler,
  stopScheduler,
  checkStaleTemperatureReadings
};
