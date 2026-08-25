const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { MongoClient } = require('mongodb');
const logger = require('../utils/logger');
const env = require('../config/env');
const backupPolicyService = require('./backup-policy.service');

const DEFAULT_RETENTION_DAYS = 30;

// #728: retention now prefers the admin-editable BackupPolicy over the
// static env var -- runBackup(db) resolves this once per run and threads
// it through to whichever cleanup path performBackup takes, so a policy
// edit is the thing actually governing how long backups are kept, not
// just a stored-but-unused field. Falls back to the env var (then the
// hardcoded default) when db isn't available -- existing callers that
// don't pass one (or run outside a request/scheduler context) keep the
// prior env-only behavior exactly.
async function resolveRetentionDays(db) {
  if (!db) return Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);

  try {
    const policy = await backupPolicyService.getPolicy(db);
    if (Number.isFinite(Number(policy?.retentionDays))) {
      return Number(policy.retentionDays);
    }
  } catch (error) {
    logger.error('Erro ao buscar política de retenção de backup, usando padrão:', error.message);
  }

  return Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
}

// #723 (RF013 AC#3): sha256 over every file under dirPath, recursively,
// in a deterministic (sorted) order -- so the same backup contents
// always produce the same checksum regardless of filesystem iteration
// order. Returns null (rather than throwing) when the directory can't
// be read, since checksum computation is completion *evidence*, not a
// precondition for the backup itself having succeeded.
//
// #742: the run's own top-level manifest.json is never part of the
// checksummed payload -- it's the checksum's carrier. performBackup/
// writeJsonBackup compute the checksum *before* writing the manifest into
// the same directory, while runControlledRestoreTest recomputes it
// *after*; without this exclusion the two walks see different file sets
// and checksumVerified was structurally always false.
const CHECKSUM_MANIFEST_FILE = 'manifest.json';

async function computeDirChecksum(dirPath) {
  const hash = crypto.createHash('sha256');

  async function walk(currentPath, relativePath) {
    const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (!relativePath && entry.name === CHECKSUM_MANIFEST_FILE) continue;
      const entryPath = path.join(currentPath, entry.name);
      const entryRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(entryPath, entryRelative);
      } else if (entry.isFile()) {
        const content = await fs.promises.readFile(entryPath);
        hash.update(entryRelative);
        hash.update(content);
      }
    }
  }

  try {
    await walk(dirPath, '');
  } catch (error) {
    logger.warn(`Não foi possível calcular checksum de ${dirPath}: ${error.message}`);
    return null;
  }

  return hash.digest('hex');
}

// #723 (RF013 AC#1): persists run-status/result history so `/list` can
// show state/date/result of executions instead of only reflecting
// filesystem directories. Reuses the caller's already-connected app db
// (no new MongoClient connection) -- a no-op when db isn't provided
// (e.g. existing callers/tests that don't pass one), so this is purely
// additive and never blocks the backup itself on a failed history write.
async function recordBackupHistory(db, entry) {
  if (!db) return;
  try {
    await db.collection('backupHistory').insertOne(entry);
  } catch (error) {
    logger.error('Erro ao registrar histórico de backup:', error.message);
  }
}

function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getBackupBaseDir() {
  return env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
}

// #731 (RNF010 AC#5): the periodic restore test needs "the backup to
// verify" without duplicating backup.routes.js's /list handler, which does
// a richer job (it merges backupHistory per path for the UI). This is the
// narrow question -- which backup directory is newest -- and nothing else.
// Returns null when the base directory does not exist yet or holds no
// backup directories, which is the normal state before the first run.
function getLatestBackupPath() {
  const baseDir = getBackupBaseDir();
  if (!fs.existsSync(baseDir)) {
    return null;
  }

  const dirs = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(baseDir, entry.name);
      return { fullPath, birthtime: fs.statSync(fullPath).birthtime };
    })
    .sort((a, b) => new Date(b.birthtime).getTime() - new Date(a.birthtime).getTime());

  return dirs.length > 0 ? dirs[0].fullPath : null;
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

async function restoreFromJsonBackup(backupPath, mongoUri, targetDbName) {
  const manifestPath = path.join(backupPath, 'manifest.json');
  const hasManifest = fs.existsSync(manifestPath);

  let manifest = null;
  if (hasManifest) {
    const rawManifest = await fs.promises.readFile(manifestPath, 'utf8');
    manifest = JSON.parse(rawManifest);
  }

  const dbName = targetDbName || manifest?.dbName || resolveDatabaseName(mongoUri);
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

    const checksum = await computeDirChecksum(backupDir);
    manifest.checksum = checksum;

    await fs.promises.writeFile(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    return {
      success: true,
      path: backupDir,
      mode: 'json-fallback',
      collections: manifest.collections.length,
      checksum
    };
  } finally {
    await client.close();
  }
}

async function performBackup(retentionDaysOverride) {
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

    const checksum = await computeDirChecksum(backupDir);
    await fs.promises.writeFile(
      path.join(backupDir, 'manifest.json'),
      JSON.stringify({
        createdAt: new Date().toISOString(),
        dbName: resolveDatabaseName(mongoUri),
        type: 'mongodump',
        checksum
      }, null, 2),
      'utf8'
    );

    const retentionDays = Number.isFinite(Number(retentionDaysOverride)) ? Number(retentionDaysOverride) : Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
    await cleanupOldBackups(baseDir, retentionDays);

    return { success: true, path: backupDir, mode: 'mongodump', checksum };
  } catch (err) {
    const details = err && err.error ? err.error.message : err?.message;
    const dumpBinaryMissing = /mongodump: not found|is not recognized|ENOENT/i.test(String(details || ''));

    if (dumpBinaryMissing) {
      try {
        logger.warn('mongodump indisponível. Usando fallback de backup em JSON.');
        const fallbackResult = await writeJsonBackup(backupDir, mongoUri);

        const retentionDays = Number.isFinite(Number(retentionDaysOverride)) ? Number(retentionDaysOverride) : Number(env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
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

// #723 (RF013 AC#1/AC#3): thin wrapper so every runBackup() call --
// whichever internal branch it takes -- records exactly one history
// entry, instead of scattering recordBackupHistory calls across each
// branch of performBackup(). `db` is optional (see recordBackupHistory);
// existing callers that don't pass one keep their prior behavior exactly.
async function runBackup(db) {
  const startedAt = new Date();
  const retentionDays = await resolveRetentionDays(db);
  const result = await performBackup(retentionDays);

  await recordBackupHistory(db, {
    startedAt,
    completedAt: new Date(),
    status: result.success ? 'success' : (result.skipped ? 'skipped' : 'error'),
    mode: result.mode || null,
    path: result.path || null,
    checksum: result.checksum || null,
    error: result.error || null
  });

  return result;
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

// #727 (RF013 AC#4): persists controlled-restore-test run history, mirroring
// recordBackupHistory's optional-db, best-effort pattern.
async function recordRestoreTestHistory(db, entry) {
  if (!db) return;
  try {
    await db.collection('restoreTestHistory').insertOne(entry);
  } catch (error) {
    logger.error('Erro ao registrar histórico de teste de restauração:', error.message);
  }
}

async function dropScratchDatabase(mongoUri, dbName) {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    await client.db(dbName).dropDatabase();
  } finally {
    await client.close();
  }
}

async function countScratchCollections(mongoUri, dbName) {
  const client = new MongoClient(mongoUri);
  try {
    await client.connect();
    const collections = await client.db(dbName).listCollections({}, { nameOnly: true }).toArray();
    return collections.length;
  } catch (_) {
    return null;
  } finally {
    await client.close();
  }
}

// #727 (RF013 AC#4): "controlled restore testing" -- restoreBackup() is the
// only restore path today and it's live/destructive (--drop against the
// configured database). This restores a backup into a disposable scratch
// database instead (named `<dbName>_restoretest_<timestamp>`, remapped via
// mongorestore's --nsFrom/--nsTo so the live db is never touched), verifies
// the backup's own checksum against its manifest first (RNF010: "validado
// por checksum"), then tears the scratch database down.
async function runControlledRestoreTest(backupPath) {
  const mongoUri = env.MONGO_URI;
  if (!mongoUri) {
    return { success: false, error: 'MONGO_URI não configurado' };
  }

  if (!backupPath || !fs.existsSync(backupPath)) {
    return { success: false, error: 'Backup não encontrado' };
  }

  const manifestPath = path.join(backupPath, 'manifest.json');
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
    } catch (_) {
      manifest = null;
    }
  }

  const recomputedChecksum = await computeDirChecksum(backupPath);
  const checksumVerified = !!(manifest && manifest.checksum && manifest.checksum === recomputedChecksum);

  const sourceDbName = (manifest && manifest.dbName) || resolveDatabaseName(mongoUri);
  const scratchDb = `${sourceDbName}_restoretest_${Date.now()}`;

  const command = `mongorestore --uri="${mongoUri}" --drop --nsFrom="${sourceDbName}.*" --nsTo="${scratchDb}.*" "${backupPath}"`;

  try {
    await runCommand(command);
    const restoredCollections = await countScratchCollections(mongoUri, scratchDb);
    await dropScratchDatabase(mongoUri, scratchDb);

    return {
      success: true,
      testedFrom: path.basename(backupPath),
      testedAt: new Date(),
      mode: 'mongorestore',
      scratchDb,
      checksumVerified,
      restoredCollections
    };
  } catch (err) {
    const details = err && err.error ? err.error.message : err?.message;
    const restoreBinaryMissing = /mongorestore: not found|is not recognized|ENOENT/i.test(String(details || ''));

    if (restoreBinaryMissing) {
      try {
        logger.warn('mongorestore indisponível. Usando fallback de teste de restauração em JSON.');
        const fallback = await restoreFromJsonBackup(backupPath, mongoUri, scratchDb);
        await dropScratchDatabase(mongoUri, scratchDb);
        return { ...fallback, scratchDb, checksumVerified };
      } catch (fallbackError) {
        const fallbackDetails = fallbackError?.message || String(fallbackError);
        logger.error('Erro no fallback de teste de restauração JSON:', fallbackDetails);
        return { success: false, error: fallbackDetails, checksumVerified };
      }
    }

    return { success: false, error: details || 'Erro ao testar restauração', checksumVerified };
  }
}

// #727 (RF013 AC#4): thin wrapper so every testRestoreBackup() call persists
// exactly one restoreTestHistory entry, same pattern as runBackup/
// recordBackupHistory above.
async function testRestoreBackup(backupPath, db) {
  const startedAt = new Date();
  const result = await runControlledRestoreTest(backupPath);

  await recordRestoreTestHistory(db, {
    startedAt,
    completedAt: new Date(),
    status: result.success ? 'success' : 'error',
    mode: result.mode || null,
    scratchDb: result.scratchDb || null,
    checksumVerified: typeof result.checksumVerified === 'boolean' ? result.checksumVerified : null,
    restoredCollections: typeof result.restoredCollections === 'number' ? result.restoredCollections : null,
    error: result.error || null
  });

  return result;
}

module.exports = {
  runBackup,
  cleanupOldBackups,
  getBackupBaseDir,
  getLatestBackupPath,
  restoreBackup,
  testRestoreBackup
};
