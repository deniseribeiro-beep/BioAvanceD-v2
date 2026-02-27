const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { MongoClient } = require('mongodb');
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

async function restoreFromJsonBackup(backupPath, mongoUri) {
  const manifestPath = path.join(backupPath, 'manifest.json');
  const hasManifest = fs.existsSync(manifestPath);

  let manifest = null;
  if (hasManifest) {
    const rawManifest = await fs.promises.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(rawManifest);
  }

  const dbName = manifest?.dbName || resolveDatabaseName(mongoUri);
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(dbName);

    let jsonFiles = [];
    if (manifest?.collections && Array.isArray(manifest.collections)) {
      jsonFiles = manifest.collections
        .map((entry) => entry?.file)
        .filter((file) => typeof file === 'string' && file.endsWith('.json'));
    }

    if (jsonFiles.length === 0) {
      jsonFiles = (await fs.promises.readdir(backupPath))
        .filter((file) => file.endsWith('.json') && file !== 'manifest.json');
    }

    if (jsonFiles.length === 0) {
      throw new Error('Nenhum arquivo JSON de backup encontrado para restore');
    }

    for (const fileName of jsonFiles) {
      const collectionName = fileName.replace(/\.json$/i, '');
      const fullPath = path.join(backupPath, fileName);

      const raw = await fs.promises.readFile(fullPath, 'utf8');
      const docs = JSON.parse(raw);

      const collection = db.collection(collectionName);
      await collection.deleteMany({});

      if (Array.isArray(docs) && docs.length > 0) {
        await collection.insertMany(docs, { ordered: false });
      }
    }

    return {
      success: true,
      restoredFrom: path.basename(backupPath),
      restoredAt: new Date(),
      mode: 'json-fallback',
      collections: jsonFiles.length
    };
  } finally {
    await client.close();
  }
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

function resolveDatabaseName(mongoUri) {
  if (env.MONGO_DB) return env.MONGO_DB;

  try {
    const parsed = new URL(mongoUri);
    const dbFromPath = parsed.pathname ? parsed.pathname.replace(/^\//, '') : '';
    return dbFromPath || 'bioavanced';
  } catch (_) {
    return 'bioavanced';
  }
}

async function writeJsonBackup(backupDir, mongoUri) {
  const dbName = resolveDatabaseName(mongoUri);
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(dbName);

    ensureDirSync(backupDir);
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    const manifest = {
      createdAt: new Date().toISOString(),
      dbName,
      type: 'json-fallback',
      collections: []
    };

    for (const collection of collections) {
      const name = collection.name;
      const docs = await db.collection(name).find({}).toArray();
      const fileName = `${name}.json`;
      const filePath = path.join(backupDir, fileName);

      await fs.promises.writeFile(filePath, JSON.stringify(docs, null, 2), 'utf8');
      manifest.collections.push({
        name,
        count: docs.length,
        file: fileName
      });
    }

    await fs.promises.writeFile(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    return {
      success: true,
      path: backupDir,
      mode: 'json-fallback',
      collections: manifest.collections.length
    };
  } finally {
    await client.close();
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
    const dumpBinaryMissing = /mongodump: not found|is not recognized|ENOENT/i.test(String(details || ''));

    if (dumpBinaryMissing) {
      try {
        logger.warn('mongodump indisponível. Usando fallback de backup em JSON.');
        const fallbackResult = await writeJsonBackup(backupDir, mongoUri);

        const retentionDays = Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
        await cleanupOldBackups(baseDir, retentionDays);

        logger.info(`✅ Backup fallback concluído: ${backupDir}`);
        return fallbackResult;
      } catch (fallbackError) {
        const fallbackDetails = fallbackError?.message || String(fallbackError);
        logger.error('Erro no fallback de backup JSON:', fallbackDetails);
        return { success: false, error: fallbackDetails };
      }
    }

    logger.error('Erro ao executar backup:', details || 'Erro desconhecido');
    return { success: false, error: details || 'Erro ao executar backup' };
  }
}

async function restoreBackup(backupPath) {
  const mongoUri = env.MONGO_URI;
  if (!mongoUri) {
    return { success: false, error: 'MONGO_URI não configurado' };
  }

  if (!backupPath || !fs.existsSync(backupPath)) {
    return { success: false, error: 'Backup não encontrado' };
  }

  const dbArg = env.MONGO_DB ? ` --nsInclude="${env.MONGO_DB}.*"` : '';
  const command = `mongorestore --uri="${mongoUri}" --drop${dbArg} "${backupPath}"`;

  try {
    await runCommand(command);
    return {
      success: true,
      restoredFrom: path.basename(backupPath),
      restoredAt: new Date(),
      mode: 'mongorestore'
    };
  } catch (err) {
    const details = err && err.error ? err.error.message : err?.message;
    const restoreBinaryMissing = /mongorestore: not found|is not recognized|ENOENT/i.test(String(details || ''));

    if (restoreBinaryMissing) {
      try {
        logger.warn('mongorestore indisponível. Usando fallback de restore em JSON.');
        return await restoreFromJsonBackup(backupPath, mongoUri);
      } catch (fallbackError) {
        const fallbackDetails = fallbackError?.message || String(fallbackError);
        logger.error('Erro no fallback de restore JSON:', fallbackDetails);
        return { success: false, error: fallbackDetails };
      }
    }

    return { success: false, error: details || 'Erro ao restaurar backup' };
  }
}

module.exports = {
  runBackup,
  cleanupOldBackups,
  getBackupBaseDir,
  restoreBackup
};
