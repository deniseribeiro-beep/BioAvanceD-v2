const cron = require('node-cron');
const logger = require('../utils/logger');
const env = require('../config/env');
const backupService = require('./backup.service');
const retentionSweepService = require('./retentionSweep.service');
const backupPolicyService = require('./backup-policy.service');
const {
  ALERT_TYPES,
  resolveActiveAlert,
  resolveActiveAlertsOfType,
  ensureActiveAlert
} = require('./alertLifecycle.service');
const influxTelemetryReadRepository = require('../infrastructure/persistence/influxdb/InfluxTelemetryReadRepository');

const DEFAULT_STALE_MINUTES = 20;

let temperatureTask = null;
let backupTask = null;
let consentSyncTask = null;
let retentionSweepTask = null;
let restoreTestTask = null;
// #1325: bumped by each reloadBackupSchedule and by stopScheduler, so a
// policy lookup that a newer reload or a stop has superseded schedules nothing.
let backupScheduleGeneration = 0;

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function checkStaleTemperatureReadings(db) {
  const sensorsCollection = db.collection('sensors');
  const alertsCollection = db.collection('alerts');

  const sensors = await sensorsCollection.find({}).toArray();
  if (!sensors.length) {
    return { sensors: 0, alerts: 0 };
  }

  // RF009 AC1 (#1317): the last reading comes from InfluxDB, one query per
  // run. A query failure raises telemetry_store_unavailable per sensor (#1388)
  // and rethrows, still writing or resolving no stale/missing alert; a
  // successful run resolves those episodes.
  let lastReadingAtBySensor;
  try {
    lastReadingAtBySensor = await influxTelemetryReadRepository.lastReadingAtBySensor();
  } catch (error) {
    for (const sensor of sensors) {
      const sensorId = sensor.sensorId || sensor.sensorID;
      if (!sensorId) continue;

      await ensureActiveAlert(alertsCollection, {
        sensorId,
        organizationId: sensor.organizationId || null,
        type: ALERT_TYPES.TELEMETRY_STORE_UNAVAILABLE,
        message: 'Armazenamento de telemetria indisponível; leituras do sensor não verificadas',
        severity: 'critical',
        status: 'active',
        timestamp: new Date(),
        createdAt: new Date()
      });
    }
    throw error;
  }

  await resolveActiveAlertsOfType(alertsCollection, ALERT_TYPES.TELEMETRY_STORE_UNAVAILABLE);

  const now = Date.now();
  const staleMinutes = Number(env.TEMP_STALE_MINUTES || DEFAULT_STALE_MINUTES);
  const staleMs = staleMinutes * 60 * 1000;

  let alertsCreated = 0;

  for (const sensor of sensors) {
    const sensorId = sensor.sensorId || sensor.sensorID;
    if (!sensorId) continue;

    const lastReadingAt = lastReadingAtBySensor.get(String(sensorId));

    if (lastReadingAt === undefined) {
      const { created } = await ensureActiveAlert(alertsCollection, {
        sensorId,
        // #1062: the second alert writer. This one iterates full sensor
        // documents, so the organization comes from the sensor itself --
        // an admin-created record rather than per-request input, which is
        // the more trustworthy of the two provenances.
        organizationId: sensor.organizationId || null,
        type: ALERT_TYPES.MISSING_READING,
        message: 'Nenhuma leitura registrada para o sensor',
        severity: 'critical',
        status: 'active',
        timestamp: new Date(),
        createdAt: new Date()
      });

      if (created) alertsCreated += 1;
      continue;
    }

    const lastTimestamp = normalizeDate(lastReadingAt);
    if (!lastTimestamp) continue;

    const isStale = now - lastTimestamp.getTime() > staleMs;

    if (isStale) {
      const { created } = await ensureActiveAlert(alertsCollection, {
        sensorId,
        organizationId: sensor.organizationId || null,
        type: ALERT_TYPES.STALE_READING,
        message: `Última leitura há mais de ${staleMinutes} minutos`,
        severity: 'warning',
        status: 'active',
        timestamp: new Date(),
        createdAt: new Date(),
        lastReadingAt: lastTimestamp
      });

      if (created) alertsCreated += 1;
    } else {
      await resolveActiveAlert(alertsCollection, sensorId, ALERT_TYPES.STALE_READING);
      await resolveActiveAlert(alertsCollection, sensorId, ALERT_TYPES.MISSING_READING);
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

// #728, #1325 (RF013 AC6): initScheduler schedules env.BACKUP_CRON
// synchronously, so a backup schedule exists from the first tick, then
// applies the stored BackupPolicy's cronExpression through
// reloadBackupSchedule below -- the same hook backupPolicy.routes.js calls
// after a policy update -- so a restart no longer reverts to BACKUP_CRON.
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

// #728, #1325 (RF013 AC5/AC6): re-creates the running backup cron task
// against the current BackupPolicy's cronExpression -- called at boot by
// initScheduler and by backupPolicy.routes.js's PUT handler right after a
// successful update, so the policy schedule holds across restarts and an
// admin's change takes effect with no restart.
// - A reload superseded by a newer reload or by stopScheduler while its
//   lookup was in flight stops and schedules nothing.
// - A failed lookup (db down, unexpected error) or a stored expression
//   node-cron refuses keeps the running task; env.BACKUP_CRON is used only
//   when no task is running, so the schedule is never left unset. Keeping
//   the task on a failed lookup is inferred from the "mantendo agendamento
//   anterior" log line: before #1325 it was replaced by the BACKUP_CRON one.
// - A policy with no cronExpression falls back to env.BACKUP_CRON.
async function reloadBackupSchedule(db) {
  const generation = ++backupScheduleGeneration;
  const timezone = process.env.TZ || 'America/Sao_Paulo';
  const envCronExpr = env.BACKUP_CRON || '0 3 * * *';

  let policy = null;
  let lookupFailed = false;
  try {
    policy = await backupPolicyService.getPolicy(db);
  } catch (error) {
    logger.error('Erro ao recarregar política de backup, mantendo agendamento anterior:', error.message);
    lookupFailed = true;
  }

  if (generation !== backupScheduleGeneration) return;

  let cronExpr = envCronExpr;
  if (lookupFailed) {
    if (backupTask) return;
  } else if (policy?.cronExpression) {
    if (cron.validate(policy.cronExpression)) {
      cronExpr = policy.cronExpression;
    } else {
      logger.error('Expressão cron inválida na política de backup, mantendo agendamento anterior:', policy.cronExpression);
      if (backupTask) return;
    }
  }

  if (backupTask) {
    backupTask.stop();
  }

  backupTask = scheduleBackupTask(db, cronExpr, timezone);
  logger.info(`🗂️ Backup diário reagendado (${cronExpr})`);
}

function startConsentSyncSchedule() {
  logger.info('[ISO20387][SYNC] Sincronização legada de consentimento removida; use a outbox canônica');
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

// #731 (RF013 AC#4 / RNF010 AC#5: "Testes de restauração são executados
// periodicamente e validados por checksum"). #727 built the sandboxed
// capability -- backupService.testRestoreBackup(), which restores into a
// scratch database and never touches the live one -- but left it
// admin-triggered only via POST /api/backup/restore-test/:fileName. This is
// the "periodicamente" half.
//
// Weekly rather than daily, and offset past the daily backup (03:00) and
// retention sweep (04:00): a restore test spins up and tears down a scratch
// database and replays every collection, so it is materially heavier than
// either. RNF010 AC#5 says "periodicamente" without naming a cadence, so
// this is a defensible default rather than a specified one -- override with
// RESTORE_TEST_CRON.
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

      // The checksum verdict is the point of the exercise (RNF010 AC#5
      // "validados por checksum"): a failed run, a checksum mismatch or a
      // missing manifest checksum included (#1325), is logged as an error
      // and never as a routine success.
      if (!result?.success) {
        logger.error(`Teste de restauração periódico falhou: ${backupPath}`, result?.error || 'erro desconhecido');
        return;
      }

      logger.info(`♻️ Teste de restauração executado: ${JSON.stringify(result)}`);
    } catch (error) {
      logger.error('Erro no teste de restauração periódico:', error.message);
    }
  }, { timezone });

  logger.info(`⏱️ Teste de restauração agendado (${cronExpr})`);
}

function initScheduler({ db, neo4jDriver }) {
  startTemperatureMonitor(db);
  startBackupSchedule(db);
  const backupPolicyApplied = db
    ? reloadBackupSchedule(db).catch((error) => {
      logger.error('Erro ao aplicar política de backup no boot:', error.message);
    })
    : Promise.resolve();
  startConsentSyncSchedule({ db, neo4jDriver });
  startRetentionSweepSchedule(db);
  startRestoreTestSchedule(db);
  return { backupPolicyApplied };
}

function stopScheduler() {
  if (temperatureTask) temperatureTask.stop();
  if (backupTask) backupTask.stop();
  backupScheduleGeneration += 1;
  backupTask = null;
  if (consentSyncTask) consentSyncTask.stop();
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
