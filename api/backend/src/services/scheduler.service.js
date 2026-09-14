const cron = require('node-cron');
const logger = require('../utils/logger');
const env = require('../config/env');
const backupService = require('./backup.service');
const retentionSweepService = require('./retentionSweep.service');
const backupPolicyService = require('./backup-policy.service');

const DEFAULT_STALE_MINUTES = 20;

let temperatureTask = null;
let backupTask = null;
let retentionSweepTask = null;
let restoreTestTask = null;

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
  if (!sensors.length) return { sensors: 0, alerts: 0 };

  const now = Date.now();
  const staleMinutes = Number(env.TEMP_STALE_MINUTES || DEFAULT_STALE_MINUTES);
  const staleMs = staleMinutes * 60 * 1000;
  let alertsCreated = 0;

  for (const sensor of sensors) {
    const sensorId = sensor.sensorId || sensor.sensorID;
    if (!sensorId) continue;

    const lastReading = await temperaturesCollection.find({ sensorId })
      .sort({ timestamp: -1, dateTime: -1, _id: -1 })
      .limit(1)
      .next();

    if (!lastReading) {
      const created = await ensureActiveAlert(alertsCollection, {
        sensorId,
        organizationId: sensor.organizationId || null,
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
        organizationId: sensor.organizationId || null,
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

function scheduleBackupTask(db, cronExpr, timezone) {
  return cron.schedule(cronExpr, async () => {
    try {
      await backupService.runBackup(db);
    } catch (error) {
      logger.error('Erro ao executar backup agendado:', error.message);
    }
  }, { timezone });
}

function startBackupSchedule(db) {
  const cronExpr = env.BACKUP_CRON || '0 3 * * *';
  const timezone = process.env.TZ || 'America/Sao_Paulo';
  backupTask = scheduleBackupTask(db, cronExpr, timezone);
  logger.info(`🗂️ Backup diário agendado (${cronExpr})`);
}

async function reloadBackupSchedule(db) {
  const timezone = process.env.TZ || 'America/Sao_Paulo';
  let cronExpr = env.BACKUP_CRON || '0 3 * * *';

  try {
    const policy = await backupPolicyService.getPolicy(db);
    if (policy?.cronExpression) cronExpr = policy.cronExpression;
  } catch (error) {
    logger.error('Erro ao recarregar política de backup, mantendo agendamento anterior:', error.message);
  }

  if (backupTask) backupTask.stop();
  backupTask = scheduleBackupTask(db, cronExpr, timezone);
  logger.info(`🗂️ Backup diário reagendado (${cronExpr})`);
}

function startConsentSyncSchedule() {
  logger.info('[ISO20387][SYNC] Sincronização legada de consentimento removida; projeções usam a outbox canônica');
  return null;
}

function startRetentionSweepSchedule(db) {
  const cronExpr = env.RETENTION_SWEEP_CRON || '0 4 * * *';
  const timezone = process.env.TZ || 'America/Sao_Paulo';

  retentionSweepTask = cron.schedule(cronExpr, async () => {
    try {
      if (!db) return;
      const result = await retentionSweepService.runSweep(db);
      logger.info(`🗑️ Sweep de retenção executado: ${JSON.stringify(result)}`);
    } catch (error) {
      logger.error('Erro no sweep de retenção:', error.message);
    }
  }, { timezone });

  logger.info(`⏱️ Sweep de retenção agendado (${cronExpr})`);
}

function startRestoreTestSchedule(db) {
  const cronExpr = env.RESTORE_TEST_CRON || '0 5 * * 0';
  const timezone = process.env.TZ || 'America/Sao_Paulo';

  restoreTestTask = cron.schedule(cronExpr, async () => {
    try {
      if (!db) return;
      const backupPath = backupService.getLatestBackupPath();
      if (!backupPath) {
        logger.warn('Nenhum backup disponível para o teste de restauração periódico');
        return;
      }

      const result = await backupService.testRestoreBackup(backupPath, db);
      if (result?.success && result?.checksumVerified === false) {
        logger.warn(`Teste de restauração concluído sem validação de checksum: ${backupPath}`);
        return;
      }
      logger.info(`♻️ Teste de restauração executado: ${JSON.stringify(result)}`);
    } catch (error) {
      logger.error('Erro no teste de restauração periódico:', error.message);
    }
  }, { timezone });

  logger.info(`⏱️ Teste de restauração agendado (${cronExpr})`);
}

function initScheduler({ db }) {
  startTemperatureMonitor(db);
  startBackupSchedule(db);
  startConsentSyncSchedule();
  startRetentionSweepSchedule(db);
  startRestoreTestSchedule(db);
}

function stopScheduler() {
  if (temperatureTask) temperatureTask.stop();
  if (backupTask) backupTask.stop();
  if (retentionSweepTask) retentionSweepTask.stop();
  if (restoreTestTask) restoreTestTask.stop();
}

module.exports = {
  initScheduler,
  stopScheduler,
  startConsentSyncSchedule,
  checkStaleTemperatureReadings,
  reloadBackupSchedule
};
