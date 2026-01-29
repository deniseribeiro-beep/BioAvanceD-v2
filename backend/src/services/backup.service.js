const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const logger = require('../utils/logger');
const env = require('../config/env');

const DEFAULT_RETENTION_DAYS = 30;

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getBackupBaseDir() {
  return env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
}

function formatDateFolder(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getBackupDirPath(baseDir, date = new Date()) {
  const dateFolder = formatDateFolder(date);
  let targetPath = path.join(baseDir, dateFolder);
  if (!fs.existsSync(targetPath)) {
    return targetPath;
  }

  const timestamp = `${dateFolder}_${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;
  return path.join(baseDir, timestamp);
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        return reject({ error, stdout, stderr });
      }
      return resolve({ stdout, stderr });
    });
  });
}

async function cleanupOldBackups(baseDir, retentionDays) {
  try {
    if (!fs.existsSync(baseDir)) return;

    const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
    const now = Date.now();
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

    await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const fullPath = path.join(baseDir, entry.name);
        let dirDate = null;

        const dateMatch = entry.name.match(/^\d{4}-\d{2}-\d{2}/);
        if (dateMatch) {
          dirDate = new Date(`${dateMatch[0]}T00:00:00.000Z`).getTime();
        } else {
          const stat = await fs.promises.stat(fullPath);
          dirDate = stat.mtime.getTime();
        }

        if (now - dirDate > maxAgeMs) {
          await fs.promises.rm(fullPath, { recursive: true, force: true });
          logger.info(`🧹 Backup removido (retenção): ${fullPath}`);
        }
      }));
  } catch (error) {
    logger.error('Erro ao limpar backups antigos:', error.message);
  }
}

async function runBackup() {
  const mongoUri = env.MONGO_URI;
  if (!mongoUri) {
    logger.warn('Backup ignorado: MONGO_URI não configurado.');
    return { success: false, skipped: true, reason: 'missing_mongo_uri' };
  }

  const baseDir = getBackupBaseDir();
  ensureDirSync(baseDir);
  const backupDir = getBackupDirPath(baseDir);

  const dbArg = env.MONGO_DB ? ` --db="${env.MONGO_DB}"` : '';
  const command = `mongodump --uri="${mongoUri}"${dbArg} --out="${backupDir}"`;

  try {
    logger.info(`🧩 Iniciando backup: ${backupDir}`);
    await runCommand(command);
    logger.info(`✅ Backup concluído: ${backupDir}`);

    const retentionDays = Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
    await cleanupOldBackups(baseDir, retentionDays);

    return { success: true, path: backupDir };
  } catch (err) {
    const details = err && err.error ? err.error.message : err?.message;
    logger.error('Erro ao executar backup:', details || 'Erro desconhecido');
    return { success: false, error: details || 'Erro ao executar backup' };
  }
}

module.exports = {
  runBackup,
  cleanupOldBackups,
  getBackupBaseDir
};
